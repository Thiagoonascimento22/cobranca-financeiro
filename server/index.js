import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { instalarCobranca } from "./cobranca.js";

// fuso de Brasília pra horário comercial, vencimentos e lembretes
process.env.TZ = process.env.TZ || "America/Sao_Paulo";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "40mb" }));

/* ============================================================
   BANCO EM ARQUIVO JSON (com espera do volume do Railway)
   ============================================================ */
const DB_PATH = process.env.DB_PATH || "/data/cobranca.json";
const MEDIA_DIR = path.join(path.dirname(DB_PATH), "media");
function garantirPastaMidia() {
  try { fs.mkdirSync(MEDIA_DIR, { recursive: true }); } catch (_) {}
}

async function aguardarVolume() {
  const dir = path.dirname(DB_PATH);
  for (let i = 0; i < 30; i++) {
    if (fs.existsSync(dir)) {
      console.log("Volume pronto. Banco em:", DB_PATH);
      return;
    }
    console.log(`Aguardando volume em ${dir}... (${i + 1})`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  console.log("Volume não detectado, usando pasta local:", dir);
}

function novoToken() {
  return crypto.randomBytes(18).toString("hex");
}

function dbVazio() {
  return {
    users: [
      {
        id: "u_admin",
        nome: "Financeiro Instructiva",
        login: "financeiro",
        senha: "admin123",
        role: "gerente", // gerente = admin do financeiro | atendente = opera o atendimento humano
        ativo: true,
        token: null,
        precisaOnboarding: true,
        criadoEm: Date.now(),
      },
    ],
    waChats: {}, // conversas do canal oficial (mesma estrutura usada pelo módulo de cobrança)
    cobranca: {}, // estrutura própria do módulo (números, IAs, campanhas, acordos) — criada sob demanda
    seq: 1,
  };
}

let db = dbVazio();

function loadDB() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, "utf-8");
      db = JSON.parse(raw);
      if (!Array.isArray(db.users)) db.users = dbVazio().users;
      if (typeof db.seq !== "number") db.seq = 1;
      if (!db.waChats || typeof db.waChats !== "object") db.waChats = {};
      if (!db.cobranca || typeof db.cobranca !== "object") db.cobranca = {};
      db.users.forEach((u) => {
        if (u.token === undefined) u.token = null;
      });
      console.log(`Banco carregado. Usuários: ${db.users.length} | Conversas: ${Object.keys(db.waChats).length}`);
    } else {
      console.log("Nenhum banco encontrado, iniciando vazio.");
    }
  } catch (e) {
    console.error("Erro ao carregar banco, iniciando vazio:", e.message);
  }
}

let salvarPendente = false;
function saveDB() {
  if (salvarPendente) return;
  salvarPendente = true;
  setImmediate(() => {
    salvarPendente = false;
    try {
      fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
      fs.writeFileSync(DB_PATH, JSON.stringify(db));
    } catch (e) {
      console.error("Erro ao salvar banco:", e.message);
    }
  });
}
function saveSoon() { saveDB(); }

function proximoId(prefixo) {
  const n = db.seq++;
  saveSoon();
  return `${prefixo}_${n}_${crypto.randomBytes(3).toString("hex")}`;
}

/* ============================================================
   AUTENTICAÇÃO
   ============================================================ */
function semSenha(u) {
  if (!u) return u;
  const { senha, token, ...resto } = u;
  return resto;
}

function auth(req, res, next) {
  const t = (req.headers.authorization || "").replace("Bearer ", "").trim();
  const user = db.users.find((u) => u.token && u.token === t);
  if (!user || !user.ativo)
    return res.status(401).json({ error: "Não autenticado" });
  req.user = user;
  next();
}
function gerenteOnly(req, res, next) {
  if (req.user.role !== "gerente")
    return res.status(403).json({ error: "Acesso restrito ao gerente do financeiro" });
  next();
}

app.post("/api/login", (req, res) => {
  const { login, senha } = req.body || {};
  const user = db.users.find(
    (u) => (u.login || "").toLowerCase() === String(login || "").toLowerCase()
  );
  if (!user || user.senha !== senha)
    return res.status(401).json({ error: "Login ou senha incorretos" });
  if (!user.ativo)
    return res.status(403).json({ error: "Usuário desativado" });
  user.token = novoToken();
  saveSoon();
  res.json({ token: user.token, user: semSenha(user) });
});

app.get("/api/me", auth, (req, res) => res.json(semSenha(req.user)));

app.put("/api/me", auth, (req, res) => {
  const { nome, senha } = req.body || {};
  if (nome && nome.trim()) req.user.nome = nome.trim();
  if (senha && senha.length >= 3) req.user.senha = senha;
  req.user.precisaOnboarding = false;
  saveSoon();
  res.json(semSenha(req.user));
});

/* ============================================================
   EQUIPE (somente gerente) — papéis: gerente | atendente
   ============================================================ */
app.get("/api/users", auth, gerenteOnly, (req, res) => {
  res.json(db.users.map(semSenha));
});

app.post("/api/users", auth, gerenteOnly, (req, res) => {
  const { nome, login, senha, role } = req.body || {};
  if (!nome || !nome.trim()) return res.status(400).json({ error: "Informe o nome" });
  if (!login || !login.trim() || !senha || senha.length < 3)
    return res.status(400).json({ error: "Login e senha (mín. 3 caracteres) são obrigatórios" });
  const roleFinal = role === "gerente" ? "gerente" : "atendente";
  const loginFinal = login.trim();
  if (db.users.some((u) => (u.login || "").toLowerCase() === loginFinal.toLowerCase()))
    return res.status(400).json({ error: "Já existe alguém com esse login" });
  const novo = {
    id: proximoId("u"),
    nome: nome.trim(),
    login: loginFinal,
    senha,
    role: roleFinal,
    ativo: true,
    token: null,
    // percentual de distribuição de leads (usado pelo motor de atribuição do módulo de cobrança)
    cobrancaAtivo: roleFinal === "atendente" ? true : false,
    cobrancaPercentual: 0,
    cobrancaLeadsRecebidos: 0,
    criadoEm: Date.now(),
  };
  db.users.push(novo);
  saveSoon();
  res.json(semSenha(novo));
});

app.put("/api/users/:id", auth, gerenteOnly, (req, res) => {
  const u = db.users.find((x) => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: "Usuário não encontrado" });
  const { nome, login, senha, role, ativo, cobrancaAtivo, cobrancaPercentual } = req.body || {};
  if (nome && nome.trim()) u.nome = nome.trim();
  if (login && login.trim()) {
    const l = login.trim();
    if (db.users.some((x) => x.id !== u.id && (x.login || "").toLowerCase() === l.toLowerCase()))
      return res.status(400).json({ error: "Já existe alguém com esse login" });
    u.login = l;
  }
  if (senha && senha.length >= 3) u.senha = senha;
  if (role) u.role = role === "gerente" ? "gerente" : "atendente";
  if (ativo !== undefined) u.ativo = !!ativo;
  if (cobrancaAtivo !== undefined) u.cobrancaAtivo = !!cobrancaAtivo;
  if (cobrancaPercentual !== undefined) u.cobrancaPercentual = Number(cobrancaPercentual) || 0;
  saveSoon();
  res.json(semSenha(u));
});

app.delete("/api/users/:id", auth, gerenteOnly, (req, res) => {
  if (req.params.id === req.user.id)
    return res.status(400).json({ error: "Você não pode excluir a si mesmo" });
  const i = db.users.findIndex((x) => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: "Usuário não encontrado" });
  db.users.splice(i, 1);
  saveSoon();
  res.json({ ok: true });
});

/* ============================================================
   MÓDULO DE COBRANÇA (canal oficial WhatsApp + IA SDR/Negociadora +
   campanhas de disparo + acompanhamento pós-acordo) — rotas /api/cobranca/*
   ============================================================ */
const cobranca = instalarCobranca({
  app,
  getDb: () => db,
  saveDB,
  proximoId,
  auth,
  gerenteOnly,
  MEDIA_DIR,
  fs,
  path,
});

/* ============================================================
   FRONTEND (build do Vite)
   ============================================================ */
const dist = path.join(__dirname, "..", "dist");
app.use("/media", express.static(MEDIA_DIR));
app.use(express.static(dist));
app.get("*", (req, res) => {
  res.sendFile(path.join(dist, "index.html"));
});

/* ============================================================
   START
   ============================================================ */
const PORT = process.env.PORT || 3000;
(async () => {
  await aguardarVolume();
  garantirPastaMidia();
  loadDB();
  if (typeof cobranca.tick === "function") {
    // varre lembretes de parcela e detecção de quebra de acordo a cada hora
    setInterval(() => cobranca.tick().catch((e) => console.error("[cobranca] erro no tick:", e.message)), 60 * 60 * 1000);
    setTimeout(() => cobranca.tick().catch(() => {}), 15000); // primeira varredura logo após subir
  }
  app.listen(PORT, () => console.log(`Sistema de Cobrança Instructiva rodando na porta ${PORT}`));
})();

import React, { useEffect, useState, useRef, useCallback } from "react";
import { api, getToken, setToken } from "./api.js";

/* ============================================================
   LOGIN
   ============================================================ */
function Login({ onLogin }) {
  const [login, setLogin] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);

  async function entrar(e) {
    e.preventDefault();
    setErro("");
    setCarregando(true);
    try {
      const r = await api.login(login, senha);
      setToken(r.token);
      onLogin(r.user);
    } catch (e) {
      setErro(e.message || "Erro ao entrar");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="logo">$</div>
        <div className="ttl">Sistema de Cobrança</div>
        <h2>Instructiva</h2>
        <p className="hi">Entre com seu usuário do financeiro</p>
        <form onSubmit={entrar}>
          <div className="field">
            <label>Usuário</label>
            <input className="input" value={login} onChange={(e) => setLogin(e.target.value)} autoFocus />
          </div>
          <div className="field">
            <label>Senha</label>
            <input className="input" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} />
          </div>
          {erro && <div className="err">{erro}</div>}
          <button className="btn btn-primary full" disabled={carregando}>{carregando ? "Entrando..." : "Entrar"}</button>
        </form>
      </div>
    </div>
  );
}

/* ============================================================
   CONVERSAS — lista + chat (canal oficial)
   ============================================================ */
const ESTADOS_LABEL = {
  nao_contatado: "Não contatado", em_conversa: "Em conversa", negociando: "Negociando",
  acordo_fechado: "Acordo fechado", pago: "Pago", perdido: "Perdido",
};

function Conversas({ me }) {
  const [lista, setLista] = useState([]);
  const [ativoId, setAtivoId] = useState(null);
  const [chat, setChat] = useState(null);
  const [texto, setTexto] = useState("");
  const [busca, setBusca] = useState("");
  const timerRef = useRef(null);

  const carregarLista = useCallback(async () => {
    try { setLista(await api.chats(busca)); } catch (_) {}
  }, [busca]);

  useEffect(() => {
    carregarLista();
    timerRef.current = setInterval(carregarLista, 6000);
    return () => clearInterval(timerRef.current);
  }, [carregarLista]);

  useEffect(() => {
    if (!ativoId) return;
    let cancelado = false;
    api.chat(ativoId).then((c) => { if (!cancelado) setChat(c); }).catch(() => {});
    const t = setInterval(() => api.chat(ativoId).then((c) => { if (!cancelado) setChat(c); }).catch(() => {}), 4000);
    return () => { cancelado = true; clearInterval(t); };
  }, [ativoId]);

  async function enviar() {
    if (!texto.trim() || !ativoId) return;
    const t = texto;
    setTexto("");
    try {
      await api.enviar(ativoId, t);
      const c = await api.chat(ativoId);
      setChat(c);
    } catch (e) { alert(e.message); }
  }

  async function mudarEstado(estado) {
    if (!ativoId) return;
    try { await api.setEstadoCobranca(ativoId, estado); const c = await api.chat(ativoId); setChat(c); carregarLista(); } catch (e) { alert(e.message); }
  }

  return (
    <div className="wa-page">
      <div className="wa-grid">
        <div className="wa-list">
          <div className="wa-list-h">
            <div className="wa-search"><input placeholder="Buscar nome ou número" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
          </div>
          <div className="wa-list-scroll">
            {lista.length === 0 && <div className="col-empty">Nenhuma conversa ainda.</div>}
            {lista.map((c) => (
              <div key={c.id} className={"wa-conv" + (c.id === ativoId ? " active" : "")} onClick={() => setAtivoId(c.id)}>
                <div className="av">{(c.nome || "?").slice(0, 1).toUpperCase()}</div>
                <div className="mid">
                  <div className="nm">{c.nome}{c.divida && c.divida.valor ? ` — ${Number(c.divida.valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}` : ""}</div>
                  <div className="last">
                    {c.estadoCobranca ? `[${ESTADOS_LABEL[c.estadoCobranca] || c.estadoCobranca}] ` : ""}
                    {c.ultima ? c.ultima.content : "—"}
                  </div>
                </div>
                {c.naoLidas > 0 && <div className="wa-badge">{c.naoLidas}</div>}
              </div>
            ))}
          </div>
        </div>

        <div className="wa-chat">
          {!chat ? (
            <div className="wa-none"><div className="ico">💬</div>Selecione uma conversa</div>
          ) : (
            <>
              <div className="wa-chat-h">
                <div className="av">{(chat.nome || "?").slice(0, 1).toUpperCase()}</div>
                <div>
                  <div className="nm">{chat.nome}</div>
                  <div className="num">{chat.numero}{chat.divida && chat.divida.vencimento ? ` · venc. ${chat.divida.vencimento}` : ""}</div>
                </div>
                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  <select className="select" value={chat.estadoCobranca || "nao_contatado"} onChange={(e) => mudarEstado(e.target.value)}>
                    {Object.keys(ESTADOS_LABEL).map((k) => <option key={k} value={k}>{ESTADOS_LABEL[k]}</option>)}
                  </select>
                </div>
              </div>
              <div className="wa-msgs">
                {(chat.mensagens || []).map((m, i) => (
                  <div key={i} className={"wa-bubble " + (m.role === "me" ? "me" : "them")}>
                    {m.content}
                    <div className="t">{new Date(m.ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}{m.porIA ? " · IA" : ""}</div>
                  </div>
                ))}
              </div>
              <div className="wa-input">
                <input placeholder="Escreva uma mensagem..." value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => e.key === "Enter" && enviar()} />
                <button className="wa-send" onClick={enviar}>Enviar</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   NÚMEROS (pool WhatsApp Cloud API)
   ============================================================ */
function Numeros() {
  const [lista, setLista] = useState([]);
  const [form, setForm] = useState({ apelido: "", numero: "", phoneNumberId: "", wabaId: "", token: "" });
  const [salvando, setSalvando] = useState(false);

  async function carregar() { try { setLista(await api.numeros()); } catch (_) {} }
  useEffect(() => { carregar(); }, []);

  async function criar(e) {
    e.preventDefault();
    setSalvando(true);
    try {
      await api.criarNumero(form);
      setForm({ apelido: "", numero: "", phoneNumberId: "", wabaId: "", token: "" });
      carregar();
    } catch (e) { alert(e.message); } finally { setSalvando(false); }
  }
  async function excluir(id) {
    if (!confirm("Remover esse número?")) return;
    await api.excluirNumero(id);
    carregar();
  }

  return (
    <div className="content">
      <div className="panel">
        <div className="panel-h"><h3>Números conectados (WhatsApp Cloud API)</h3></div>
        {lista.map((n) => (
          <div className="urow" key={n.id}>
            <div className="info"><div className="nm">{n.apelido}</div><div className="sub">{n.numero || n.phoneNumberId}</div></div>
            <span className={"tag-off " + (n.ativo ? "" : "off")}>{n.ativo ? "ativo" : "inativo"}</span>
            <button className="btn btn-sm btn-danger" onClick={() => excluir(n.id)}>Remover</button>
          </div>
        ))}
        {lista.length === 0 && <div className="col-empty">Nenhum número cadastrado ainda.</div>}
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-h"><h3>Conectar novo número</h3></div>
        <form onSubmit={criar}>
          <div className="row2">
            <div className="field"><label>Apelido</label><input className="input" value={form.apelido} onChange={(e) => setForm({ ...form, apelido: e.target.value })} placeholder="Ex: Financeiro Cobrança" /></div>
            <div className="field"><label>Número (visual)</label><input className="input" value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} placeholder="Ex: 44 9 9999-0000" /></div>
          </div>
          <div className="field"><label>Phone Number ID (Meta)</label><input className="input" value={form.phoneNumberId} onChange={(e) => setForm({ ...form, phoneNumberId: e.target.value })} /></div>
          <div className="field"><label>WABA ID</label><input className="input" value={form.wabaId} onChange={(e) => setForm({ ...form, wabaId: e.target.value })} /></div>
          <div className="field"><label>Token de acesso permanente</label><input className="input" type="password" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} /></div>
          <button className="btn btn-primary" disabled={salvando}>{salvando ? "Salvando..." : "Conectar número"}</button>
        </form>
      </div>
    </div>
  );
}

/* ============================================================
   EQUIPE
   ============================================================ */
function Equipe() {
  const [lista, setLista] = useState([]);
  const [form, setForm] = useState({ nome: "", login: "", senha: "", role: "atendente" });

  async function carregar() { try { setLista(await api.listUsers()); } catch (_) {} }
  useEffect(() => { carregar(); }, []);

  async function criar(e) {
    e.preventDefault();
    try { await api.createUser(form); setForm({ nome: "", login: "", senha: "", role: "atendente" }); carregar(); }
    catch (e) { alert(e.message); }
  }
  async function excluir(id) { if (!confirm("Remover esse usuário?")) return; await api.deleteUser(id); carregar(); }

  return (
    <div className="content">
      <div className="panel">
        <div className="panel-h"><h3>Equipe do financeiro</h3></div>
        {lista.map((u) => (
          <div className="urow" key={u.id}>
            <div className="info"><div className="nm">{u.nome}</div><div className="sub">@{u.login}</div></div>
            <span className={"tag-role " + (u.role === "gerente" ? "ger" : "ven")}>{u.role}</span>
            <button className="btn btn-sm btn-danger" onClick={() => excluir(u.id)}>Remover</button>
          </div>
        ))}
      </div>
      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-h"><h3>Adicionar pessoa</h3></div>
        <form onSubmit={criar}>
          <div className="row2">
            <div className="field"><label>Nome</label><input className="input" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
            <div className="field"><label>Login</label><input className="input" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} /></div>
          </div>
          <div className="row2">
            <div className="field"><label>Senha</label><input className="input" type="password" value={form.senha} onChange={(e) => setForm({ ...form, senha: e.target.value })} /></div>
            <div className="field"><label>Papel</label>
              <select className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="atendente">Atendente</option>
                <option value="gerente">Gerente</option>
              </select>
            </div>
          </div>
          <button className="btn btn-primary">Adicionar</button>
        </form>
      </div>
    </div>
  );
}

/* ============================================================
   PLACEHOLDER — seções da próxima etapa
   ============================================================ */
function EmConstrucao({ titulo, descricao }) {
  return (
    <div className="content">
      <div className="empty-big">
        <div className="ico">🚧</div>
        <h3>{titulo}</h3>
        <p>{descricao}</p>
        <p className="sub">Backend já está pronto e funcionando — essa tela entra na próxima etapa do frontend.</p>
      </div>
    </div>
  );
}

/* ============================================================
   SHELL
   ============================================================ */
const NAV = [
  { k: "conversas", lb: "Conversas", ico: "💬" },
  { k: "ias", lb: "IAs (SDR / Negociadora)", ico: "🤖" },
  { k: "disparo", lb: "Disparo em massa", ico: "📣" },
  { k: "acordos", lb: "Acordos (pós-acordo)", ico: "📅" },
  { k: "numeros", lb: "Números", ico: "📱" },
  { k: "equipe", lb: "Equipe", ico: "👥" },
];

export default function App() {
  const [user, setUser] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [secao, setSecao] = useState("conversas");

  useEffect(() => {
    if (!getToken()) { setCarregando(false); return; }
    api.me().then(setUser).catch(() => setToken("")).finally(() => setCarregando(false));
  }, []);

  function sair() { setToken(""); setUser(null); }

  if (carregando) return <div className="spin" />;
  if (!user) return <Login onLogin={setUser} />;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="tag">Cobrança Instructiva</span></div>
        <nav className="nav">
          {NAV.map((it) => (
            <button key={it.k} className={secao === it.k ? "active" : ""} onClick={() => setSecao(it.k)}>
              <span className="ico">{it.ico}</span>{it.lb}
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <div className="side-user">
            <div className="avatar">{(user.nome || "?").slice(0, 1).toUpperCase()}</div>
            <div><div className="nm">{user.nome}</div><div className="rl">{user.role}</div></div>
          </div>
          <button className="logout" onClick={sair}>Sair</button>
        </div>
      </aside>
      <main className="main">
        <div className="topbar"><div className="greet">Olá, {user.nome.split(" ")[0]}</div></div>
        {secao === "conversas" && <Conversas me={user} />}
        {secao === "numeros" && <Numeros />}
        {secao === "equipe" && <Equipe />}
        {secao === "ias" && <EmConstrucao titulo="IAs — SDR e Negociadora" descricao="Aqui você vai criar e treinar as duas IAs (qualificação e negociação), definir os limites de desconto/parcelamento e testar antes de ativar." />}
        {secao === "disparo" && <EmConstrucao titulo="Disparo em massa" descricao="Aqui você vai importar o CSV da base inadimplente (nome, telefone, valor, vencimento, código do aluno) e disparar a campanha." />}
        {secao === "acordos" && <EmConstrucao titulo="Acordos — Automação Pós-Acordo" descricao="Aqui você vai acompanhar as parcelas de cada acordo fechado, ver lembretes enviados e quebras de acordo detectadas automaticamente." />}
      </main>
    </div>
  );
}

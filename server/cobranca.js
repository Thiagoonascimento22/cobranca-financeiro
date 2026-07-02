/* ============================================================
   SISTEMA DE COBRANÇA INSTRUCTIVA — módulo único
   ------------------------------------------------------------
   Camadas (desenho do diretor):
   1. IA SDR de Cobrança      -> qualifica, entende o motivo da
                                  inadimplência, coleta informações.
   2. IA Negociadora           -> apresenta propostas dentro das
                                  regras definidas pela empresa.
   3. Atendente humano         -> entra só em casos de interesse
                                  real ou negociação mais complexa.
   4. Automação Pós-Acordo     -> acompanha parcelas, manda lembrete
                                  e identifica quebra de acordo.
   ============================================================ */

const GRAPH = "https://graph.facebook.com/v21.0";

export function instalarCobranca({ app, getDb, saveDB, proximoId, auth, gerenteOnly, MEDIA_DIR, fs, path }) {
  const db = new Proxy({}, {
    get: (_t, k) => getDb()[k],
    set: (_t, k, v) => { getDb()[k] = v; return true; },
    has: (_t, k) => k in getDb(),
  });

  function garantirEstrutura() {
    if (!db.cobranca || typeof db.cobranca !== "object") db.cobranca = {};
    const c = db.cobranca;
    if (!Array.isArray(c.numeros)) c.numeros = [];
    if (!Array.isArray(c.campanhas)) c.campanhas = [];
    if (!Array.isArray(c.ias)) c.ias = [];
    if (!Array.isArray(c.acordos)) c.acordos = [];
    if (typeof c.iaGlobalAtiva !== "boolean") c.iaGlobalAtiva = true;
    if (!c.verifyToken) c.verifyToken = "instructiva_cob_" + Math.random().toString(36).slice(2, 10);
    if (!c.horario) c.horario = horarioPadrao();
    if (!c.config) c.config = { templateLembrete: "", templateQuebra: "", diasAntesLembrete: 2, diasCarencia: 2 };
    if (c.config.diasAntesLembrete === undefined) c.config.diasAntesLembrete = 2;
    if (c.config.diasCarencia === undefined) c.config.diasCarencia = 2;
  }
  function salvar() { saveDB(); }

  /* ============================================================
     HORÁRIO COMERCIAL (respeitado pelo disparo e pelos lembretes —
     cobrança tem limite legal de horário de contato)
     ============================================================ */
  function horarioPadrao() {
    const dias = {};
    for (let d = 0; d <= 6; d++) {
      dias[d] = { on: d >= 1 && d <= 6, inicio: "08:00", fim: "20:00" }; // Seg-Sáb, 8h-20h por padrão
    }
    return { enabled: true, dias };
  }
  function normalizaHorario(h) {
    const base = horarioPadrao();
    if (!h || typeof h !== "object") return base;
    base.enabled = h.enabled !== false;
    if (h.dias && typeof h.dias === "object") {
      for (let d = 0; d <= 6; d++) {
        const x = h.dias[d] || h.dias[String(d)] || {};
        base.dias[d] = {
          on: x.on !== undefined ? !!x.on : base.dias[d].on,
          inicio: typeof x.inicio === "string" && x.inicio ? x.inicio : "08:00",
          fim: typeof x.fim === "string" && x.fim ? x.fim : "20:00",
        };
      }
    }
    return base;
  }
  function dentroDoHorario() {
    garantirEstrutura();
    const h = db.cobranca.horario;
    if (!h || !h.enabled) return true;
    const agora = new Date();
    const dia = h.dias[agora.getDay()];
    if (!dia || !dia.on) return false;
    const hm = agora.getHours() * 60 + agora.getMinutes();
    const [hi, mi] = String(dia.inicio || "08:00").split(":").map(Number);
    const [hf, mf] = String(dia.fim || "20:00").split(":").map(Number);
    return hm >= (hi * 60 + mi) && hm <= (hf * 60 + mf);
  }

  /* ---- helpers de número do pool ---- */
  function acharNumero(id) {
    return (db.cobranca.numeros || []).find((n) => n.id === id) || null;
  }
  function numeroPublico(n) {
    return { id: n.id, apelido: n.apelido, numero: n.numero, phoneNumberId: n.phoneNumberId, wabaId: n.wabaId, ativo: n.ativo, temToken: !!n.token };
  }

  function soDigitos(s) { return String(s || "").replace(/\D/g, ""); }
  function normalizaTelefone(s) {
    let d = soDigitos(s);
    if (!d) return "";
    if (!d.startsWith("55")) d = "55" + d;
    return d;
  }
  function lim(s, n) { return String(s == null ? "" : s).slice(0, n); }
  function fmtMoedaBR(v) {
    const n = Number(v);
    if (isNaN(n)) return String(v || "");
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }
  function fmtDataBR(iso) {
    if (!iso) return "";
    const d = new Date(iso + "T00:00:00-03:00");
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString("pt-BR");
  }
  function somaDias(iso, dias) {
    const d = new Date(iso + "T00:00:00-03:00");
    d.setDate(d.getDate() + dias);
    return d.toISOString().slice(0, 10);
  }
  function diasDeAtraso(vencimentoISO) {
    if (!vencimentoISO) return null;
    const venc = new Date(vencimentoISO + "T00:00:00-03:00");
    if (isNaN(venc.getTime())) return null;
    return Math.floor((Date.now() - venc.getTime()) / (1000 * 60 * 60 * 24));
  }

  /* ============================================================
     DISTRIBUIÇÃO PONDERADA PRO ATENDENTE HUMANO (mesma lógica do
     CRM comercial, só que pra role "atendente")
     ============================================================ */
  function atendentesElegiveis() {
    return db.users.filter((u) => u.role === "atendente" && u.ativo && u.cobrancaAtivo);
  }
  function escolherAtendente() {
    const ativos = atendentesElegiveis();
    if (ativos.length === 0) return null;
    const totalDistribuido = ativos.reduce((s, v) => s + (v.cobrancaLeadsRecebidos || 0), 0);
    let somaPesos = ativos.reduce((s, v) => s + (Number(v.cobrancaPercentual) || 0), 0);
    const usarIgual = somaPesos <= 0;
    if (usarIgual) somaPesos = ativos.length;
    let escolhido = null, melhorDeficit = -Infinity;
    for (const v of ativos) {
      const peso = usarIgual ? 1 : (Number(v.cobrancaPercentual) || 0);
      const cotaEsperada = ((totalDistribuido + 1) * peso) / somaPesos;
      const recebido = v.cobrancaLeadsRecebidos || 0;
      const deficit = cotaEsperada - recebido;
      if (deficit > melhorDeficit || (deficit === melhorDeficit && recebido < (escolhido.cobrancaLeadsRecebidos || 0))) {
        melhorDeficit = deficit;
        escolhido = v;
      }
    }
    return escolhido;
  }
  function atribuirAtendente(chat) {
    if (chat.atendenteId) return chat.atendenteId;
    const v = escolherAtendente();
    if (!v) return null;
    chat.atendenteId = v.id;
    chat.atendenteNome = v.nome;
    chat.atribuidoEm = Date.now();
    v.cobrancaLeadsRecebidos = (v.cobrancaLeadsRecebidos || 0) + 1;
    return v.id;
  }

  /* ============================================================
     CHAT (reaproveita db.waChats, canal "oficial")
     ============================================================ */
  function chaveChat(numeroId, telefone) { return `oficial::${numeroId}::${telefone}`; }
  function acharOuCriarChat(numeroId, telefone, nome) {
    const id = chaveChat(numeroId, telefone);
    let chat = db.waChats[id];
    if (!chat) {
      chat = {
        id, canal: "oficial", numeroOficialId: numeroId, instance: id,
        numero: telefone, nome: nome || telefone,
        mensagens: [], naoLidas: 0, atualizadoEm: Date.now(),
        atendenteId: null, estadoCobranca: "nao_contatado",
      };
      db.waChats[id] = chat;
    }
    return chat;
  }

  /* ============================================================
     GRAPH API (WhatsApp Cloud) — envio, mídia, templates
     ============================================================ */
  async function graphPost(numeroCfg, payload) {
    const r = await fetch(`${GRAPH}/${numeroCfg.phoneNumberId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + numeroCfg.token },
      body: JSON.stringify(payload),
    });
    let data = null;
    try { data = await r.json(); } catch (_) {}
    if (!r.ok) throw new Error((data && data.error && data.error.message) || ("Erro Graph " + r.status));
    return data;
  }
  async function enviarTextoOficial(numeroCfg, telefone, texto) {
    return graphPost(numeroCfg, { messaging_product: "whatsapp", to: telefone, type: "text", text: { body: texto } });
  }
  function tipoPorMime(mime) {
    const m = String(mime || "").toLowerCase();
    if (m.startsWith("image/")) return "image";
    if (m.startsWith("video/")) return "video";
    if (m.startsWith("audio/")) return "audio";
    return "document";
  }
  function extPorMime(mime) {
    const map = {
      "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
      "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/amr": "amr", "audio/wav": "wav",
      "video/mp4": "mp4", "video/3gpp": "3gp", "application/pdf": "pdf",
    };
    return map[String(mime || "").toLowerCase().split(";")[0]] || "bin";
  }
  async function uploadMidiaMeta(numeroCfg, buffer, mimeType, filename) {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("file", new Blob([buffer], { type: mimeType }), filename || "arquivo");
    const r = await fetch(`${GRAPH}/${numeroCfg.phoneNumberId}/media`, {
      method: "POST", headers: { Authorization: "Bearer " + numeroCfg.token }, body: form,
    });
    let data = null;
    try { data = await r.json(); } catch (_) {}
    if (!r.ok || !data || !data.id) throw new Error((data && data.error && data.error.message) || ("Erro upload mídia " + r.status));
    return data.id;
  }
  async function enviarMidiaOficial(numeroCfg, telefone, tipo, mediaId, caption, filename) {
    const payload = { messaging_product: "whatsapp", to: telefone, type: tipo };
    const obj = { id: mediaId };
    if (caption && (tipo === "image" || tipo === "video" || tipo === "document")) obj.caption = caption;
    if (tipo === "document" && filename) obj.filename = filename;
    payload[tipo] = obj;
    return graphPost(numeroCfg, payload);
  }
  async function baixarMidiaMeta(numeroCfg, mediaId) {
    if (!MEDIA_DIR || !fs || !path || !mediaId) return null;
    try {
      const r1 = await fetch(`${GRAPH}/${mediaId}`, { headers: { Authorization: "Bearer " + numeroCfg.token } });
      if (!r1.ok) return null;
      const meta = await r1.json();
      if (!meta || !meta.url) return null;
      const r2 = await fetch(meta.url, { headers: { Authorization: "Bearer " + numeroCfg.token } });
      if (!r2.ok) return null;
      const buf = Buffer.from(await r2.arrayBuffer());
      const mime = meta.mime_type || "application/octet-stream";
      const fname = "of_" + mediaId + "." + extPorMime(mime);
      fs.writeFileSync(path.join(MEDIA_DIR, fname), buf);
      return { arquivo: fname, mimetype: mime, buffer: buf, tamanho: buf.length };
    } catch (e) { console.log("[cobranca] erro ao baixar mídia:", e.message); return null; }
  }
  async function transcreverAudio(buffer, mimetype) {
    const key = process.env.GROQ_API_KEY;
    if (!key || !buffer) return null;
    try {
      const fd = new FormData();
      fd.append("file", new Blob([buffer], { type: mimetype || "audio/ogg" }), "audio." + (extPorMime(mimetype) || "ogg"));
      fd.append("model", "whisper-large-v3-turbo");
      fd.append("language", "pt");
      fd.append("response_format", "text");
      const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST", headers: { Authorization: "Bearer " + key }, body: fd,
      });
      if (!r.ok) return null;
      return (await r.text() || "").trim() || null;
    } catch (e) { return null; }
  }
  function montarComponents(variaveis) {
    if (!variaveis || !variaveis.length) return undefined;
    return [{ type: "body", parameters: variaveis.map((v) => ({ type: "text", text: String(v) })) }];
  }
  async function enviarTemplate(numeroCfg, telefone, templateName, idioma, variaveis) {
    const template = { name: templateName, language: { code: idioma || "pt_BR" } };
    const comps = montarComponents(variaveis);
    if (comps) template.components = comps;
    return graphPost(numeroCfg, { messaging_product: "whatsapp", to: telefone, type: "template", template });
  }

  /* ============================================================
     ROTAS — POOL DE NÚMEROS (gerente)
     ============================================================ */
  garantirEstrutura();

  app.get("/api/cobranca/numeros", auth, gerenteOnly, (req, res) => {
    garantirEstrutura();
    res.json((db.cobranca.numeros || []).map(numeroPublico));
  });

  async function assinarWebhook(n) {
    if (!n || !n.wabaId || !n.token) return false;
    try {
      const r = await fetch(`${GRAPH}/${n.wabaId}/subscribed_apps`, {
        method: "POST", headers: { Authorization: `Bearer ${n.token}`, "Content-Type": "application/json" },
      });
      if (r.ok) { n.webhookAssinado = true; n.webhookAssinadoEm = Date.now(); return true; }
    } catch (e) {}
    return false;
  }

  app.post("/api/cobranca/numeros", auth, gerenteOnly, async (req, res) => {
    garantirEstrutura();
    const b = req.body || {};
    const apelido = String(b.apelido || "").trim();
    const phoneNumberId = String(b.phoneNumberId || "").trim();
    const token = String(b.token || "").trim();
    if (!apelido || !phoneNumberId || !token) return res.status(400).json({ error: "Informe apelido, Phone Number ID e Token" });
    const novo = {
      id: proximoId("num"), apelido,
      numero: String(b.numero || "").trim(),
      phoneNumberId, wabaId: String(b.wabaId || "").trim(), token,
      ativo: true,
    };
    db.cobranca.numeros.push(novo);
    await assinarWebhook(novo);
    salvar();
    res.json(numeroPublico(novo));
  });

  app.put("/api/cobranca/numeros/:id", auth, gerenteOnly, async (req, res) => {
    const n = acharNumero(req.params.id);
    if (!n) return res.status(404).json({ error: "Número não encontrado" });
    const b = req.body || {};
    if (b.apelido !== undefined) n.apelido = String(b.apelido).trim();
    if (b.numero !== undefined) n.numero = String(b.numero).trim();
    if (b.phoneNumberId !== undefined) n.phoneNumberId = String(b.phoneNumberId).trim();
    if (b.wabaId !== undefined) n.wabaId = String(b.wabaId).trim();
    if (b.token) n.token = String(b.token).trim();
    if (b.ativo !== undefined) n.ativo = !!b.ativo;
    await assinarWebhook(n);
    salvar();
    res.json(numeroPublico(n));
  });

  app.delete("/api/cobranca/numeros/:id", auth, gerenteOnly, (req, res) => {
    const i = (db.cobranca.numeros || []).findIndex((n) => n.id === req.params.id);
    if (i < 0) return res.status(404).json({ error: "Número não encontrado" });
    db.cobranca.numeros.splice(i, 1);
    salvar();
    res.json({ ok: true });
  });

  app.post("/api/cobranca/numeros/:id/registrar", auth, gerenteOnly, async (req, res) => {
    const n = acharNumero(req.params.id);
    if (!n) return res.status(404).json({ error: "Número não encontrado" });
    const pin = String((req.body && req.body.pin) || "").replace(/\D/g, "");
    if (pin.length !== 6) return res.status(400).json({ error: "O PIN precisa ter 6 dígitos" });
    try {
      const r = await fetch(`${GRAPH}/${n.phoneNumberId}/register`, {
        method: "POST", headers: { Authorization: `Bearer ${n.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", pin }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return res.status(400).json({ error: (data.error && data.error.message) || "Falha ao registrar (confira o PIN)" });
      n.registrado = true; n.registradoEm = Date.now();
      salvar();
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/cobranca/numeros/:id/templates", auth, gerenteOnly, async (req, res) => {
    const n = acharNumero(req.params.id);
    if (!n) return res.status(404).json({ error: "Número não encontrado" });
    if (!n.wabaId) return res.status(400).json({ error: "Esse número não tem WABA ID configurado" });
    try {
      const r = await fetch(`${GRAPH}/${n.wabaId}/message_templates?fields=name,status,category,language,components&limit=100`, {
        headers: { Authorization: "Bearer " + n.token },
      });
      const data = await r.json();
      if (!r.ok) return res.status(400).json({ error: (data.error && data.error.message) || ("Erro Graph " + r.status) });
      const todos = (data.data || []).map((t) => {
        const body = (t.components || []).find((c) => c.type === "BODY");
        const texto = body ? body.text || "" : "";
        return { name: t.name, language: t.language, category: t.category, status: t.status, vars: (texto.match(/\{\{\d+\}\}/g) || []).length, texto };
      });
      res.json({ templates: todos.filter((t) => t.status === "APPROVED"), todos });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/cobranca/numeros/:id/templates", auth, gerenteOnly, async (req, res) => {
    const n = acharNumero(req.params.id);
    if (!n) return res.status(404).json({ error: "Número não encontrado" });
    if (!n.wabaId) return res.status(400).json({ error: "Esse número não tem WABA ID configurado" });
    const b = req.body || {};
    const nome = String(b.nome || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    const corpo = String(b.corpo || "").trim();
    const categoria = String(b.categoria || "UTILITY").toUpperCase();
    const idioma = String(b.idioma || "pt_BR").trim();
    if (!nome || !corpo) return res.status(400).json({ error: "Informe o nome e o texto do template" });
    try {
      const r = await fetch(`${GRAPH}/${n.wabaId}/message_templates`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + n.token },
        body: JSON.stringify({
          name: nome, language: idioma,
          category: categoria === "MARKETING" ? "MARKETING" : "UTILITY",
          components: [{ type: "BODY", text: corpo }],
        }),
      });
      const data = await r.json();
      if (!r.ok) return res.status(400).json({ error: (data.error && data.error.message) || ("Erro Graph " + r.status) });
      res.json({ ok: true, id: data.id, status: data.status || "PENDING", category: data.category || categoria });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* horário comercial (limite legal de contato) */
  app.get("/api/cobranca/horario", auth, (req, res) => { garantirEstrutura(); res.json(db.cobranca.horario); });
  app.put("/api/cobranca/horario", auth, gerenteOnly, (req, res) => {
    garantirEstrutura();
    db.cobranca.horario = normalizaHorario(req.body || {});
    salvar();
    res.json(db.cobranca.horario);
  });

  /* configurações gerais de pós-acordo */
  app.get("/api/cobranca/config", auth, gerenteOnly, (req, res) => { garantirEstrutura(); res.json(db.cobranca.config); });
  app.put("/api/cobranca/config", auth, gerenteOnly, (req, res) => {
    garantirEstrutura();
    const b = req.body || {};
    const c = db.cobranca.config;
    if (b.templateLembrete !== undefined) c.templateLembrete = lim(b.templateLembrete, 200);
    if (b.templateQuebra !== undefined) c.templateQuebra = lim(b.templateQuebra, 200);
    if (b.diasAntesLembrete !== undefined) c.diasAntesLembrete = Math.max(0, Math.min(10, Number(b.diasAntesLembrete) || 2));
    if (b.diasCarencia !== undefined) c.diasCarencia = Math.max(0, Math.min(15, Number(b.diasCarencia) || 2));
    salvar();
    res.json(c);
  });

  /* ============================================================
     PROMPTS DAS IAs — SDR e Negociadora
     ============================================================ */
  const TOM_LABEL = {
    amigavel: "amigável e próximo", profissional: "profissional",
    descontraido: "descontraído", consultivo: "consultivo", direto: "direto e objetivo",
  };
  function configVazia() {
    return {
      tomVoz: "profissional", objetivo: "",
      quemEla: "", comoEscreve: "", sempreFaz: "", nuncaFaz: "",
      objecoes: [], faq: [],
      pbAbertura: "", pbConfirmacao: "", pbColeta: "", pbNegociacao: "", pbFechamento: "", pbRecuperacao: "",
      escQuando: "", escFrase: "", encerrarCriterios: "",
      // só usados pela Negociadora — o "treino" do limite de autonomia
      formasPagamento: "", parcelamentoMax: 0, descontoMaximoPct: 0, regrasNegociacao: "",
    };
  }
  function sanitizaConfig(raw) {
    const c = configVazia();
    const b = raw || {};
    c.tomVoz = lim(b.tomVoz || "profissional", 40);
    c.objetivo = lim(b.objetivo, 2000);
    c.quemEla = lim(b.quemEla, 6000);
    c.comoEscreve = lim(b.comoEscreve, 3000);
    c.sempreFaz = lim(b.sempreFaz, 4000);
    c.nuncaFaz = lim(b.nuncaFaz, 4000);
    c.objecoes = Array.isArray(b.objecoes) ? b.objecoes.slice(0, 50).map((x) => ({ objecao: lim(x.objecao, 300), resposta: lim(x.resposta, 2000) })) : [];
    c.faq = Array.isArray(b.faq) ? b.faq.slice(0, 80).map((x) => ({ pergunta: lim(x.pergunta, 300), resposta: lim(x.resposta, 2000) })) : [];
    c.pbAbertura = lim(b.pbAbertura, 3000);
    c.pbConfirmacao = lim(b.pbConfirmacao, 3000);
    c.pbColeta = lim(b.pbColeta, 3000);
    c.pbNegociacao = lim(b.pbNegociacao, 3000);
    c.pbFechamento = lim(b.pbFechamento, 3000);
    c.pbRecuperacao = lim(b.pbRecuperacao, 3000);
    c.escQuando = lim(b.escQuando, 3000);
    c.escFrase = lim(b.escFrase, 1000);
    c.encerrarCriterios = lim(b.encerrarCriterios, 2000);
    c.formasPagamento = lim(b.formasPagamento, 500);
    c.parcelamentoMax = Math.max(0, Math.min(60, Number(b.parcelamentoMax) || 0));
    c.descontoMaximoPct = Math.max(0, Math.min(100, Number(b.descontoMaximoPct) || 0));
    c.regrasNegociacao = lim(b.regrasNegociacao, 4000);
    return c;
  }
  function sanitizaConhecimento(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, 60).map((k) => ({
      id: k.id || proximoId("kb"), secao: lim(k.secao || "geral", 30),
      nome: lim(k.nome, 200), texto: lim(k.texto, 200000), criadoEm: k.criadoEm || Date.now(),
    }));
  }
  function normalizaPapel(p) { return p === "negociadora" ? "negociadora" : "sdr"; }

  function blocoComplianceEDadosDivida(nomeLead, divida) {
    const P = [];
    if (nomeLead) P.push(`O nome do aluno com quem você fala é: ${nomeLead}.`);
    if (divida && (divida.valor || divida.vencimento)) {
      const atraso = diasDeAtraso(divida.vencimento);
      const linhas = [];
      if (divida.valor) linhas.push(`Valor em aberto: ${fmtMoedaBR(divida.valor)}`);
      if (divida.vencimento) linhas.push(`Vencimento original: ${fmtDataBR(divida.vencimento)}`);
      if (atraso !== null) linhas.push(`Dias de atraso até hoje: ${atraso >= 0 ? atraso : 0}${atraso < 0 ? " (ainda não venceu, é um lembrete preventivo)" : ""}`);
      if (divida.codigoAluno) linhas.push(`Código do aluno no sistema: ${divida.codigoAluno}`);
      P.push(`\nDADOS DESTA COBRANÇA (use exatamente esses números, nunca invente ou arredonde):\n- ${linhas.join("\n- ")}`);
    } else {
      P.push(`\nATENÇÃO: não há dados de dívida carregados pra esse contato. NÃO invente valor, vencimento ou qualquer dado financeiro.`);
    }
    P.push(`\nREGRAS DE COMPLIANCE (LGPD / CDC — inegociáveis):`);
    P.push(`- NUNCA exponha a dívida ou dados do aluno pra terceiros (família, colegas, quem responder no lugar dele).`);
    P.push(`- NUNCA use tom de ameaça, constrangimento ou pressão abusiva. Não use "negativação", "protesto" ou "ação judicial" como ameaça.`);
    P.push(`- NUNCA confirme ou negue dívida pra alguém que não comprovou ser o titular.`);
    return P.join("\n");
  }

  // IA 1 — SDR: entende o motivo da inadimplência, coleta informações, e decide se
  // encaminha pra Negociadora (lead disposto a resolver) ou direto pro humano (caso complexo/disputa)
  function montarPromptSDR(ia, nomeLead, divida) {
    const c = ia.config || {};
    const P = [];
    P.push(`Você é ${ia.nome}, atendente do setor financeiro da Escola Instructiva, primeiro contato pelo WhatsApp com um aluno em atraso de pagamento.`);
    P.push(`Seu tom de voz é ${TOM_LABEL[c.tomVoz] || "profissional"}, sempre respeitoso.`);
    P.push(`\nSEU OBJETIVO (você NÃO negocia valores nem propõe parcelamento — isso é outra etapa): confirmar que fala com a pessoa certa, entender o MOTIVO do atraso (dificuldade financeira, esqueceu, discorda da cobrança, etc.) e sinalizar se o aluno está disposto a regularizar.`);
    if (c.objetivo) P.push(c.objetivo);
    P.push(blocoComplianceEDadosDivida(nomeLead, divida));
    if (c.quemEla) P.push(`\nQUEM VOCÊ É:\n${c.quemEla}`);
    if (c.comoEscreve) P.push(`\nCOMO VOCÊ ESCREVE:\n${c.comoEscreve}`);
    if (c.sempreFaz) P.push(`\nVOCÊ SEMPRE:\n${c.sempreFaz}`);
    if (c.nuncaFaz) P.push(`\nVOCÊ NUNCA:\n${c.nuncaFaz}`);
    if (c.objecoes && c.objecoes.length) {
      P.push(`\nCOMO RESPONDER OBJEÇÕES INICIAIS:`);
      c.objecoes.forEach((o) => { if (o.objecao) P.push(`- Se disser "${o.objecao}": ${o.resposta || ""}`); });
    }
    if (c.faq && c.faq.length) {
      P.push(`\nPERGUNTAS FREQUENTES:`);
      c.faq.forEach((q) => { if (q.pergunta) P.push(`- P: ${q.pergunta}\n  R: ${q.resposta || ""}`); });
    }
    const etapas = [
      ["Abertura", c.pbAbertura], ["Confirmação de identidade", c.pbConfirmacao],
      ["Coleta do motivo do atraso", c.pbColeta], ["Recuperação (se sumir)", c.pbRecuperacao],
    ].filter(([, v]) => v);
    if (etapas.length) { P.push(`\nROTEIRO:`); etapas.forEach(([t, v], i) => P.push(`${i + 1}. ${t}: ${v}`)); }
    const kb = (ia.conhecimento || []).filter((k) => k.texto);
    if (kb.length) { P.push(`\nBASE DE CONHECIMENTO:`); kb.forEach((k) => P.push(`\n--- ${k.nome} ---\n${lim(k.texto, 40000)}`)); }

    P.push(`\nQUANDO PASSAR PRA NEGOCIAÇÃO (tag [PASSAR_NEGOCIADORA] no final): assim que o aluno confirmar a própria identidade e demonstrar QUALQUER disposição em resolver a pendência (ex.: "quero pagar", "como faço", "posso parcelar", "vou ver isso"), passe. Antes da tag, se o aluno contou o motivo do atraso, resuma em UMA frase curta usando o formato [MOTIVO: resumo aqui] logo antes de [PASSAR_NEGOCIADORA] (essas duas tags não aparecem pro aluno).`);
    P.push(`\nQUANDO PASSAR DIRETO PRO HUMANO (tag [PASSAR_HUMANO] no final, SEM passar pela negociadora): o aluno disputa a dívida (diz que já pagou, não reconhece, não fez o curso), menciona Procon/advogado/ação judicial, fica hostil, ou pede pra falar com uma pessoa/gerente.`);
    if (c.escQuando) P.push(`Além disso: ${c.escQuando}`);
    P.push(`\nREGRA DA PASSAGEM: o aluno NÃO PERCEBE a troca de atendente, seja pra negociação ou pro humano. Nunca diga que vai "transferir" ou "chamar alguém". Sua última mensagem deve soar como continuidade natural${c.escFrase ? ` (ex.: "${c.escFrase}")` : ""}. As tags nunca aparecem pro aluno.`);
    if (c.encerrarCriterios) P.push(`\nEncerre/pare de insistir quando: ${c.encerrarCriterios}`);
    P.push(`\nREGRAS GERAIS: mensagens curtas de WhatsApp, uma ideia por vez, nunca diga que é IA. Nunca invente valores ou datas. Nome do aluno só se confirmado. Emojis simples e raros (🙂 😊 👍).`);
    return P.join("\n");
  }

  // IA 2 — Negociadora: já assumiu que o aluno quer resolver; apresenta propostas
  // dentro das regras configuradas; fecha (propõe formalmente) ou escala pro humano
  function montarPromptNegociadora(ia, nomeLead, divida, motivo) {
    const c = ia.config || {};
    const P = [];
    P.push(`Você é ${ia.nome}, negociadora do setor financeiro da Escola Instructiva, dando continuidade a uma conversa de cobrança pelo WhatsApp — o aluno já confirmou identidade e disposição pra resolver a pendência.`);
    P.push(`Seu tom de voz é ${TOM_LABEL[c.tomVoz] || "profissional"}, sempre respeitoso e resolutivo.`);
    if (c.objetivo) P.push(`SEU OBJETIVO: ${c.objetivo}`);
    else P.push(`SEU OBJETIVO: apresentar as formas de pagamento e fechar um acordo dentro das regras abaixo.`);
    if (motivo) P.push(`\nO motivo do atraso que o aluno relatou anteriormente: ${motivo}. Use isso com empatia, sem ficar repetindo.`);
    P.push(blocoComplianceEDadosDivida(nomeLead, divida));
    if (c.quemEla) P.push(`\nQUEM VOCÊ É:\n${c.quemEla}`);
    if (c.comoEscreve) P.push(`\nCOMO VOCÊ ESCREVE:\n${c.comoEscreve}`);
    if (c.sempreFaz) P.push(`\nVOCÊ SEMPRE:\n${c.sempreFaz}`);
    if (c.nuncaFaz) P.push(`\nVOCÊ NUNCA:\n${c.nuncaFaz}`);

    const regrasNeg = [];
    if (c.formasPagamento) regrasNeg.push(`Formas de pagamento aceitas: ${c.formasPagamento}`);
    if (c.parcelamentoMax) regrasNeg.push(`Pode oferecer parcelamento em até ${c.parcelamentoMax}x sem aprovação humana.`);
    else regrasNeg.push(`NÃO pode oferecer parcelamento por conta própria — qualquer pedido de parcelas vai pra [PASSAR_HUMANO].`);
    if (c.descontoMaximoPct) regrasNeg.push(`Pode oferecer no máximo ${c.descontoMaximoPct}% de desconto à vista sozinha. Desconto maior exige [PASSAR_HUMANO].`);
    else regrasNeg.push(`NÃO pode oferecer desconto nenhum sozinha — qualquer pedido de desconto vai pra [PASSAR_HUMANO].`);
    if (c.regrasNegociacao) regrasNeg.push(c.regrasNegociacao);
    P.push(`\nREGRAS DE NEGOCIAÇÃO (limite da sua autonomia):\n- ${regrasNeg.join("\n- ")}`);

    if (c.objecoes && c.objecoes.length) {
      P.push(`\nCOMO RESPONDER OBJEÇÕES NA NEGOCIAÇÃO:`);
      c.objecoes.forEach((o) => { if (o.objecao) P.push(`- Se disser "${o.objecao}": ${o.resposta || ""}`); });
    }
    if (c.faq && c.faq.length) {
      P.push(`\nPERGUNTAS FREQUENTES:`);
      c.faq.forEach((q) => { if (q.pergunta) P.push(`- P: ${q.pergunta}\n  R: ${q.resposta || ""}`); });
    }
    const etapas = [["Apresentação das opções", c.pbNegociacao], ["Fechamento", c.pbFechamento], ["Recuperação (se sumir)", c.pbRecuperacao]].filter(([, v]) => v);
    if (etapas.length) { P.push(`\nROTEIRO:`); etapas.forEach(([t, v], i) => P.push(`${i + 1}. ${t}: ${v}`)); }
    const kb = (ia.conhecimento || []).filter((k) => k.texto);
    if (kb.length) { P.push(`\nBASE DE CONHECIMENTO:`); kb.forEach((k) => P.push(`\n--- ${k.nome} ---\n${lim(k.texto, 40000)}`)); }

    P.push(`\nQUANDO O ALUNO ACEITAR UMA CONDIÇÃO DENTRO DAS SUAS REGRAS: confirme os números com clareza e finalize com a tag [ACORDO_PROPOSTO: parcelas=N; valor_parcela=V; vencimento=YYYY-MM-DD] no final (nunca visível pro aluno), onde N é o nº de parcelas (1 se à vista), V o valor de cada parcela em número puro (ex: 250.00) e vencimento a data da primeira parcela. Isso registra o acordo pra confirmação — diga ao aluno que ele vai receber a confirmação por aqui mesmo, sem mencionar "sistema" ou "confirmação humana".`);
    P.push(`\nQUANDO PASSAR PRA UM HUMANO (tag [PASSAR_HUMANO] no final): pedido fora do seu limite de autonomia (mais parcelas, mais desconto), disputa da dívida, menção a Procon/advogado/ação judicial, hostilidade, ou pedido explícito de falar com uma pessoa.`);
    if (c.escQuando) P.push(`Além disso: ${c.escQuando}`);
    P.push(`\nREGRA DA PASSAGEM: o aluno não percebe a troca. Última mensagem soa como continuidade natural${c.escFrase ? ` (ex.: "${c.escFrase}")` : ""}.`);
    if (c.encerrarCriterios) P.push(`\nEncerre/pare de insistir quando: ${c.encerrarCriterios}`);
    P.push(`\nREGRAS GERAIS: mensagens curtas de WhatsApp, nunca diga que é IA, nunca invente valores/datas/links fora do que está acima. Emojis simples e raros.`);
    return P.join("\n");
  }

  function montarSystemPrompt(ia, chat) {
    const nomeLead = chat ? chat.nome : "";
    const divida = chat ? chat.divida : null;
    const motivo = chat ? chat.motivoInadimplencia : "";
    return ia.papel === "negociadora"
      ? montarPromptNegociadora(ia, nomeLead, divida, motivo)
      : montarPromptSDR(ia, nomeLead, divida);
  }

  async function chamarModelo(systemPrompt, historico) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY não configurada");
    const msgsHist = historico.map((m) => ({
      role: m.role === "them" ? "user" : "assistant",
      content: (m.role === "them" && m.transcricao) ? m.transcricao : (m.content || ""),
    })).filter((m) => m.content);
    while (msgsHist.length && msgsHist[0].role !== "user") msgsHist.shift();
    if (!msgsHist.length) return "";
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({ model: "gpt-4o-mini", max_tokens: 1024, messages: [{ role: "system", content: systemPrompt }, ...msgsHist] }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((data.error && data.error.message) || "Erro OpenAI " + r.status);
    return ((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "").trim();
  }

  function tempoDigitacao(texto) {
    const n = (texto || "").length;
    const min = 8000, max = 14000, baixo = 120, alto = 400;
    if (n <= baixo) return min;
    if (n >= alto) return max;
    return Math.round(min + ((n - baixo) / (alto - baixo)) * (max - min));
  }
  async function mostrarDigitando(numeroCfg, ultimaMsgId) {
    if (!ultimaMsgId) return;
    try {
      await graphPost(numeroCfg, { messaging_product: "whatsapp", status: "read", message_id: ultimaMsgId, typing_indicator: { type: "text" } });
    } catch (_) {}
  }

  const SINAIS_ESCALONAMENTO = [
    "já paguei", "ja paguei", "não devo", "nao devo", "não reconheço", "nao reconheco",
    "contestar", "contestação", "não fiz esse curso", "nao fiz esse curso",
    "procon", "advogado", "processo", "ação judicial", "acao judicial", "justiça", "justica",
    "quero falar com", "quero falar com o gerente", "isso é assédio", "isso e assedio",
    "isso é abuso", "vou denunciar", "golpe", "fraude",
  ];

  // registra um acordo (chamado pela negociadora via tag, ou manualmente pelo humano)
  function registrarAcordo(chat, { parcelas, valorParcela, vencimento, criadoPor }) {
    garantirEstrutura();
    const n = Math.max(1, Math.min(48, Number(parcelas) || 1));
    const v = Number(valorParcela) || 0;
    const primeiraData = vencimento && /^\d{4}-\d{2}-\d{2}$/.test(vencimento) ? vencimento : new Date().toISOString().slice(0, 10);
    const listaParcelas = [];
    for (let i = 0; i < n; i++) {
      listaParcelas.push({ numero: i + 1, valor: v, vencimento: somaDias(primeiraData, i * 30), status: "pendente", lembreteEnviadoEm: null, pagoEm: null });
    }
    const acordo = {
      id: proximoId("acordo"), chatId: chat.id, numero: chat.numero, nomeAluno: chat.nome,
      numeroOficialId: chat.numeroOficialId, criadoEm: Date.now(), criadoPor: criadoPor || "IA Negociadora",
      parcelas: listaParcelas, quebrado: false,
    };
    db.cobranca.acordos.push(acordo);
    chat.estadoCobranca = "acordo_fechado";
    chat.acordoAtivoId = acordo.id;
    if (!Array.isArray(chat.notas)) chat.notas = [];
    chat.notas.push({ tipo: "acordo_registrado", texto: `Acordo registrado por ${acordo.criadoPor}: ${n}x de ${fmtMoedaBR(v)}, 1ª parcela em ${fmtDataBR(primeiraData)}`, ts: Date.now(), por: acordo.criadoPor });
    salvar();
    return acordo;
  }

  async function rodarIA(chat, numeroCfg) {
    try {
      garantirEstrutura();
      if (db.cobranca.iaGlobalAtiva === false) return;
      const ia = (db.cobranca.ias || []).find((x) => x.id === chat.iaId);
      if (!ia || !ia.ativa) return;
      const system = montarSystemPrompt(ia, chat);
      const histDireto = (chat.mensagens || []).slice(-24);
      let resposta = await chamarModelo(system, histDireto);
      if (!resposta) return;

      let passarHumano = false, passarNegociadora = false, acordoProposto = null;

      if (resposta.includes("[PASSAR_HUMANO]")) { passarHumano = true; resposta = resposta.replace(/\[PASSAR_HUMANO\]/g, "").trim(); }
      if (resposta.includes("[PASSAR_NEGOCIADORA]")) { passarNegociadora = true; resposta = resposta.replace(/\[PASSAR_NEGOCIADORA\]/g, "").trim(); }
      const mMotivo = resposta.match(/\[MOTIVO:\s*([^\]]+)\]/i);
      if (mMotivo) { chat.motivoInadimplencia = lim(mMotivo[1], 500); resposta = resposta.replace(/\[MOTIVO:[^\]]+\]/i, "").trim(); }
      const mAcordo = resposta.match(/\[ACORDO_PROPOSTO:\s*parcelas=(\d+);\s*valor_parcela=([\d.,]+);\s*vencimento=(\d{4}-\d{2}-\d{2})\]/i);
      if (mAcordo) {
        acordoProposto = { parcelas: mAcordo[1], valorParcela: mAcordo[2].replace(",", "."), vencimento: mAcordo[3] };
        resposta = resposta.replace(mAcordo[0], "").trim();
      }

      // rede de segurança por palavra-chave (não depende só do modelo lembrar da tag)
      if (!passarHumano) {
        const ultLead = [...(chat.mensagens || [])].reverse().find((m) => m.role === "them");
        const txtLead = ((ultLead && (ultLead.transcricao || ultLead.content)) || "").toLowerCase();
        if (SINAIS_ESCALONAMENTO.some((s) => txtLead.includes(s))) passarHumano = true;
      }

      if (resposta) {
        const espera = tempoDigitacao(resposta);
        await mostrarDigitando(numeroCfg, chat.ultimaMsgLeadId);
        await new Promise((r) => setTimeout(r, espera));
        await enviarTextoOficial(numeroCfg, chat.numero, resposta);
        const ts = Date.now();
        chat.mensagens.push({ role: "me", content: resposta, ts, porIA: true });
        if (chat.mensagens.length > 300) chat.mensagens = chat.mensagens.slice(-300);
        chat.atualizadoEm = ts;
      }

      if (!Array.isArray(chat.notas)) chat.notas = [];

      if (passarHumano) {
        chat.iaPausada = true;
        atribuirAtendente(chat);
        chat.respondeu = true;
        chat.naoLidas = (chat.naoLidas || 0) + 1;
        chat.atualizadoEm = Date.now();
        chat.notas.push({ tipo: "ia_handoff", texto: `${ia.nome} (IA ${ia.papel}) passou o atendimento pra um humano${chat.atendenteNome ? " (" + chat.atendenteNome + ")" : ""}`, ts: Date.now(), por: ia.nome });
        if (chat.estadoCobranca !== "acordo_fechado" && chat.estadoCobranca !== "pago") chat.estadoCobranca = "negociando";
      } else if (passarNegociadora && ia.papel === "sdr" && ia.proximaIaId) {
        chat.iaId = ia.proximaIaId; // troca de "cérebro" na mesma conversa, sem o aluno perceber
        chat.estadoCobranca = "negociando";
        chat.notas.push({ tipo: "sdr_para_negociadora", texto: `${ia.nome} (SDR) qualificou e encaminhou pra negociação${chat.motivoInadimplencia ? " — motivo: " + chat.motivoInadimplencia : ""}`, ts: Date.now(), por: ia.nome });
      } else if (ia.papel === "sdr" && chat.estadoCobranca === "nao_contatado") {
        chat.estadoCobranca = "em_conversa";
      }

      if (acordoProposto) {
        const c = ia.config || {};
        chat.acordoProposto = { ...acordoProposto, propostoEm: Date.now() };
        chat.notas.push({ tipo: "acordo_proposto", texto: `${ia.nome} propôs: ${acordoProposto.parcelas}x de ${fmtMoedaBR(acordoProposto.valorParcela)} a partir de ${fmtDataBR(acordoProposto.vencimento)} — aguardando confirmação`, ts: Date.now(), por: ia.nome });
        if (c.autoConfirmarAcordo) {
          registrarAcordo(chat, { parcelas: acordoProposto.parcelas, valorParcela: acordoProposto.valorParcela, vencimento: acordoProposto.vencimento, criadoPor: ia.nome + " (auto)" });
        }
      }

      if (chat.notas.length > 100) chat.notas = chat.notas.slice(-100);
      salvar();
    } catch (e) {
      console.error("[cobranca] erro rodarIA:", e.message);
    }
  }

  /* ============================================================
     ROTAS — IAs (SDR e Negociadora)
     ============================================================ */
  function iaPublica(ia) {
    return {
      id: ia.id, nome: ia.nome, ativa: !!ia.ativa, papel: ia.papel, proximaIaId: ia.proximaIaId || null,
      config: ia.config || configVazia(),
      conhecimento: (ia.conhecimento || []).map((k) => ({ id: k.id, secao: k.secao, nome: k.nome, chars: (k.texto || "").length, criadoEm: k.criadoEm })),
      criadoEm: ia.criadoEm,
    };
  }
  app.get("/api/cobranca/ias", auth, gerenteOnly, (req, res) => { garantirEstrutura(); res.json((db.cobranca.ias || []).map(iaPublica)); });
  app.post("/api/cobranca/ias", auth, gerenteOnly, (req, res) => {
    garantirEstrutura();
    const b = req.body || {};
    const nome = String(b.nome || "").trim();
    if (!nome) return res.status(400).json({ error: "Dê um nome pra IA" });
    const ia = {
      id: proximoId("ia"), nome: nome.slice(0, 80), ativa: b.ativa !== false,
      papel: normalizaPapel(b.papel), proximaIaId: b.proximaIaId || null,
      config: sanitizaConfig(b.config), conhecimento: sanitizaConhecimento(b.conhecimento),
      criadoEm: Date.now(),
    };
    db.cobranca.ias.unshift(ia);
    salvar();
    res.json(iaPublica(ia));
  });
  app.put("/api/cobranca/ias/:id", auth, gerenteOnly, (req, res) => {
    const ia = (db.cobranca.ias || []).find((x) => x.id === req.params.id);
    if (!ia) return res.status(404).json({ error: "IA não encontrada" });
    const b = req.body || {};
    if (b.nome !== undefined) { const n = String(b.nome).trim(); if (n) ia.nome = n.slice(0, 80); }
    if (b.papel !== undefined) ia.papel = normalizaPapel(b.papel);
    if (b.proximaIaId !== undefined) ia.proximaIaId = b.proximaIaId || null;
    if (b.ativa !== undefined) ia.ativa = !!b.ativa;
    if (b.config !== undefined) ia.config = sanitizaConfig(b.config);
    if (b.conhecimento !== undefined) ia.conhecimento = sanitizaConhecimento(b.conhecimento);
    salvar();
    res.json(iaPublica(ia));
  });
  app.delete("/api/cobranca/ias/:id", auth, gerenteOnly, (req, res) => {
    const antes = (db.cobranca.ias || []).length;
    db.cobranca.ias = (db.cobranca.ias || []).filter((x) => x.id !== req.params.id);
    salvar();
    res.json({ ok: true, removida: antes !== db.cobranca.ias.length });
  });
  app.get("/api/cobranca/ia-global", auth, gerenteOnly, (req, res) => { garantirEstrutura(); res.json({ ativa: db.cobranca.iaGlobalAtiva !== false }); });
  app.post("/api/cobranca/ia-global", auth, gerenteOnly, (req, res) => {
    garantirEstrutura();
    db.cobranca.iaGlobalAtiva = !!(req.body && req.body.ativa);
    salvar();
    res.json({ ok: true, ativa: db.cobranca.iaGlobalAtiva });
  });

  app.post("/api/cobranca/chats/:id/ia", auth, gerenteOnly, (req, res) => {
    const chat = db.waChats[req.params.id];
    if (!chat || chat.canal !== "oficial") return res.status(404).json({ error: "Conversa não encontrada" });
    const pausar = !!(req.body && req.body.pausar);
    chat.iaPausada = pausar;
    if (!Array.isArray(chat.notas)) chat.notas = [];
    chat.notas.push({ tipo: pausar ? "ia_pausada" : "ia_retomada", texto: `${req.user.nome} ${pausar ? "pausou a IA e assumiu" : "devolveu o atendimento pra IA"}`, ts: Date.now(), por: req.user.nome });
    salvar();
    res.json({ ok: true, iaPausada: chat.iaPausada });
  });

  /* PREVIEW: testa a IA (SDR ou Negociadora) sem WhatsApp de verdade */
  app.post("/api/cobranca/ias/preview", auth, gerenteOnly, async (req, res) => {
    const b = req.body || {};
    const iaFake = { nome: String(b.nome || "IA").trim() || "IA", papel: normalizaPapel(b.papel), config: sanitizaConfig(b.config), conhecimento: sanitizaConhecimento(b.conhecimento) };
    const historico = Array.isArray(b.historico) ? b.historico.slice(-24) : [];
    if (!historico.length) return res.status(400).json({ error: "Sem mensagens" });
    try {
      const chatFake = { nome: b.nomeLead || "", divida: b.divida || null, motivoInadimplencia: b.motivo || "" };
      const system = montarSystemPrompt(iaFake, chatFake);
      let resposta = await chamarModelo(system, historico);
      const passarHumano = resposta.includes("[PASSAR_HUMANO]");
      const passarNegociadora = resposta.includes("[PASSAR_NEGOCIADORA]");
      resposta = resposta.replace(/\[PASSAR_HUMANO\]/g, "").replace(/\[PASSAR_NEGOCIADORA\]/g, "").replace(/\[MOTIVO:[^\]]+\]/gi, "").replace(/\[ACORDO_PROPOSTO:[^\]]+\]/gi, "").trim();
      res.json({ ok: true, resposta, passarHumano, passarNegociadora });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ============================================================
     DISPARO EM MASSA (CSV: nome, telefone, valor, vencimento, código do aluno)
     ============================================================ */
  function sanitizaDivida(d) {
    if (!d || typeof d !== "object") return null;
    const out = {};
    if (d.valor !== undefined && d.valor !== "") out.valor = Number(d.valor) || 0;
    if (d.vencimento) out.vencimento = lim(d.vencimento, 10);
    if (d.codigoAluno) out.codigoAluno = lim(d.codigoAluno, 60);
    return Object.keys(out).length ? out : null;
  }

  app.post("/api/cobranca/disparar", auth, gerenteOnly, async (req, res) => {
    garantirEstrutura();
    const b = req.body || {};
    const numeroCfg = acharNumero(b.numeroId);
    if (!numeroCfg) return res.status(400).json({ error: "Escolha um número válido" });
    if (!numeroCfg.ativo) return res.status(400).json({ error: "Esse número está inativo" });
    const templateName = String(b.template || "").trim();
    if (!templateName) return res.status(400).json({ error: "Escolha um template" });
    const idioma = String(b.idioma || "pt_BR").trim();
    const contatos = Array.isArray(b.contatos) ? b.contatos : [];
    if (!contatos.length) return res.status(400).json({ error: "Nenhum contato na lista" });
    if (contatos.length > 5000) return res.status(400).json({ error: "Máximo de 5000 por disparo" });
    const iaId = String(b.iaId || "").trim();
    const iaCampanha = iaId ? (db.cobranca.ias || []).find((x) => x.id === iaId && x.ativa) : null;
    if (iaId && !iaCampanha) return res.status(400).json({ error: "IA selecionada não existe ou está pausada" });

    const campanha = {
      id: proximoId("camp"), nome: String(b.nomeCampanha || templateName).trim(),
      numeroId: numeroCfg.id, template: templateName, idioma,
      iaId: iaCampanha ? iaCampanha.id : null, iaNome: iaCampanha ? iaCampanha.nome : null,
      enviados: 0, entregues: 0, lidos: 0, responderam: 0, falhas: 0, total: contatos.length,
      pendentes: contatos.map((c) => ({ telefone: c.telefone, nome: c.nome || "", variaveis: c.variaveis || [], divida: sanitizaDivida(c.divida) })),
      envios: [], // log permanente por contato (telefone, nome, status, erro, ts) — sobrevive mesmo depois da fila esvaziar
      status: "rodando", criadoEm: Date.now(),
    };
    db.cobranca.campanhas.unshift(campanha);
    salvar();
    res.json({ ok: true, campanhaId: campanha.id, total: contatos.length });
    processarFilaCampanha(campanha.id, numeroCfg);
  });

  async function processarFilaCampanha(campanhaId, numeroCfg) {
    const campanha = (db.cobranca.campanhas || []).find((x) => x.id === campanhaId);
    if (!campanha || campanha._rodando) return;
    if (!Array.isArray(campanha.envios)) campanha.envios = [];
    campanha._rodando = true;
    campanha.status = "rodando";
    while (campanha.pendentes && campanha.pendentes.length > 0) {
      // respeita o horário comercial — se estiver fora, espera 10min e checa de novo
      if (!dentroDoHorario()) { await new Promise((r) => setTimeout(r, 10 * 60 * 1000)); continue; }
      const c = campanha.pendentes[0];
      const telefone = normalizaTelefone(c.telefone);
      if (!telefone) {
        campanha.falhas++;
        campanha.envios.push({ telefone: c.telefone || "", nome: c.nome || "", status: "falha", erro: "Telefone inválido", ts: Date.now() });
        campanha.pendentes.shift(); salvar(); continue;
      }
      const nome = (c.nome || "").trim() || telefone;
      try {
        const resp = await enviarTemplate(numeroCfg, telefone, campanha.template, campanha.idioma, c.variaveis || []);
        campanha.enviados++;
        const mid = resp && resp.messages && resp.messages[0] && resp.messages[0].id;
        if (mid) { if (!db.cobranca.msgCampanha) db.cobranca.msgCampanha = {}; db.cobranca.msgCampanha[mid] = campanha.id; }
        campanha.envios.push({ telefone, nome, status: "enviado", statusEntrega: "enviado", mid: mid || null, ts: Date.now() });
        const chat = acharOuCriarChat(numeroCfg.id, telefone, nome);
        chat.origemDisparo = true; chat.campanha = campanha.nome; chat.campanhaId = campanha.id;
        chat.iaId = campanha.iaId || null; chat.iaPausada = false;
        if (chat.respondeu === undefined) chat.respondeu = false;
        if (c.divida) chat.divida = c.divida;
        if (!chat.estadoCobranca) chat.estadoCobranca = "nao_contatado";
        const ts = Date.now();
        chat.mensagens.push({ role: "me", content: `[disparo] ${campanha.template}`, ts, template: true });
        chat.atualizadoEm = ts;
      } catch (e) {
        campanha.falhas++;
        campanha.envios.push({ telefone, nome, status: "falha", erro: e.message, ts: Date.now() });
        console.error("[cobranca] falha disparo p/", telefone, ":", e.message);
      }
      if (campanha.envios.length > 5000) campanha.envios = campanha.envios.slice(-5000);
      campanha.pendentes.shift();
      salvar();
      await new Promise((r) => setTimeout(r, 120));
    }
    campanha.status = "concluida"; campanha._rodando = false;
    delete campanha.pendentes;
    salvar();
  }

  app.post("/api/cobranca/campanhas/:id/retomar", auth, gerenteOnly, (req, res) => {
    const campanha = (db.cobranca.campanhas || []).find((x) => x.id === req.params.id);
    if (!campanha) return res.status(404).json({ error: "Campanha não encontrada" });
    if (!campanha.pendentes || !campanha.pendentes.length) return res.status(400).json({ error: "Sem envios pendentes" });
    const numeroCfg = acharNumero(campanha.numeroId);
    if (!numeroCfg || !numeroCfg.ativo) return res.status(400).json({ error: "Número inválido ou inativo" });
    const faltam = campanha.pendentes.length;
    processarFilaCampanha(campanha.id, numeroCfg);
    res.json({ ok: true, faltam });
  });

  app.get("/api/cobranca/campanhas", auth, gerenteOnly, (req, res) => {
    garantirEstrutura();
    res.json((db.cobranca.campanhas || []).map((c) => ({ ...c, pendentes: undefined, envios: undefined, pendentesCount: c.pendentes ? c.pendentes.length : 0 })));
  });
  app.get("/api/cobranca/campanhas/:id", auth, gerenteOnly, (req, res) => {
    const c = (db.cobranca.campanhas || []).find((x) => x.id === req.params.id);
    if (!c) return res.status(404).json({ error: "Campanha não encontrada" });
    const numeroCfg = acharNumero(c.numeroId);
    res.json({ ...c, pendentes: undefined, pendentesCount: c.pendentes ? c.pendentes.length : 0, numeroApelido: numeroCfg ? numeroCfg.apelido : "" });
  });
  app.delete("/api/cobranca/campanhas/:id", auth, gerenteOnly, (req, res) => {
    const antes = (db.cobranca.campanhas || []).length;
    db.cobranca.campanhas = (db.cobranca.campanhas || []).filter((x) => x.id !== req.params.id);
    salvar();
    res.json({ ok: true, removida: antes !== db.cobranca.campanhas.length });
  });

  /* ============================================================
     CHATS — listagem, abrir, enviar, atribuir, estado do funil
     ============================================================ */
  const ESTADOS_COBRANCA = ["nao_contatado", "em_conversa", "negociando", "acordo_fechado", "pago", "perdido"];

  app.get("/api/cobranca/chats", auth, (req, res) => {
    const q = String(req.query.q || "").trim().toLowerCase();
    let chats = Object.values(db.waChats).filter((c) => c.canal === "oficial");
    if (!(String(req.query.encerrados || "") === "1")) chats = chats.filter((c) => !c.encerrado);
    if (req.user.role !== "gerente") {
      chats = chats.filter((c) => c.atendenteId === req.user.id && (!c.origemDisparo || c.respondeu) && !(c.iaId && !c.iaPausada));
    }
    if (q) chats = chats.filter((c) => (c.nome || "").toLowerCase().includes(q) || (c.numero || "").includes(q));
    const lista = chats.sort((a, b) => (b.atualizadoEm || 0) - (a.atualizadoEm || 0)).slice(0, 500).map((c) => {
      const ultima = c.mensagens && c.mensagens.length ? c.mensagens[c.mensagens.length - 1] : null;
      const at = c.atendenteId ? db.users.find((u) => u.id === c.atendenteId) : null;
      return {
        id: c.id, numero: c.numero, nome: c.nome, naoLidas: c.naoLidas || 0, atualizadoEm: c.atualizadoEm || 0,
        origemDisparo: !!c.origemDisparo, campanha: c.campanha || "", atendenteId: c.atendenteId || null,
        atendenteNome: at ? at.nome : "", numeroOficialId: c.numeroOficialId,
        comIA: !!(c.iaId && !c.iaPausada), iaPassou: !!(c.iaId && c.iaPausada && c.atendenteId),
        divida: c.divida || null, estadoCobranca: c.estadoCobranca || null, acordoProposto: c.acordoProposto || null,
        ultima: ultima ? { role: ultima.role, content: String(ultima.content || "").slice(0, 80), ts: ultima.ts } : null,
      };
    });
    res.json(lista);
  });

  app.get("/api/cobranca/chats/:id", auth, (req, res) => {
    const chat = db.waChats[req.params.id];
    if (!chat || chat.canal !== "oficial") return res.status(404).json({ error: "Conversa não encontrada" });
    chat.naoLidas = 0;
    salvar();
    res.json(chat);
  });

  app.post("/api/cobranca/chats/:id/send", auth, async (req, res) => {
    const chat = db.waChats[req.params.id];
    if (!chat || chat.canal !== "oficial") return res.status(404).json({ error: "Conversa não encontrada" });
    if (req.user.role !== "gerente" && chat.atendenteId !== req.user.id) return res.status(403).json({ error: "Sem acesso a essa conversa" });
    const texto = String((req.body && req.body.texto) || "").trim();
    if (!texto) return res.status(400).json({ error: "Mensagem vazia" });
    const numeroCfg = acharNumero(chat.numeroOficialId);
    if (!numeroCfg) return res.status(400).json({ error: "Número não encontrado" });
    try {
      await enviarTextoOficial(numeroCfg, chat.numero, texto);
      const ts = Date.now();
      chat.mensagens.push({ role: "me", content: texto, ts });
      chat.atualizadoEm = ts;
      salvar();
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/cobranca/chats/:id/atribuir", auth, (req, res) => {
    const chat = db.waChats[req.params.id];
    if (!chat || chat.canal !== "oficial") return res.status(404).json({ error: "Conversa não encontrada" });
    if (req.user.role !== "gerente" && chat.atendenteId !== req.user.id) return res.status(403).json({ error: "Você só pode transferir conversas suas" });
    const v = db.users.find((u) => u.id === String((req.body && req.body.atendenteId) || "") && u.role === "atendente");
    if (!v) return res.status(400).json({ error: "Atendente inválido" });
    chat.atendenteId = v.id; chat.atendenteNome = v.nome; chat.atribuidoEm = Date.now();
    if (!Array.isArray(chat.notas)) chat.notas = [];
    chat.notas.push({ tipo: "transferencia", texto: `${req.user.nome} transferiu para ${v.nome}`, ts: Date.now(), por: req.user.nome });
    salvar();
    res.json({ ok: true, atendenteId: v.id, atendenteNome: v.nome });
  });

  app.get("/api/cobranca/atendentes-lista", auth, (req, res) => {
    res.json(db.users.filter((u) => u.role === "atendente" && u.ativo).map((u) => ({ id: u.id, nome: u.nome, cobrancaAtivo: !!u.cobrancaAtivo })));
  });

  app.post("/api/cobranca/chats/:id/encerrar", auth, (req, res) => {
    const chat = db.waChats[req.params.id];
    if (!chat || chat.canal !== "oficial") return res.status(404).json({ error: "Conversa não encontrada" });
    if (req.user.role !== "gerente" && chat.atendenteId !== req.user.id) return res.status(403).json({ error: "Sem acesso" });
    const encerrar = req.body && req.body.encerrar !== false;
    chat.encerrado = !!encerrar;
    if (encerrar) chat.encerradoEm = Date.now();
    salvar();
    res.json({ ok: true, encerrado: chat.encerrado });
  });

  app.post("/api/cobranca/chats/:id/cobranca-estado", auth, (req, res) => {
    const chat = db.waChats[req.params.id];
    if (!chat || chat.canal !== "oficial") return res.status(404).json({ error: "Conversa não encontrada" });
    if (req.user.role !== "gerente" && chat.atendenteId !== req.user.id) return res.status(403).json({ error: "Sem acesso" });
    const estado = String((req.body && req.body.estado) || "");
    if (!ESTADOS_COBRANCA.includes(estado)) return res.status(400).json({ error: "Estado inválido" });
    chat.estadoCobranca = estado;
    if (!Array.isArray(chat.notas)) chat.notas = [];
    chat.notas.push({ tipo: "cobranca_estado", texto: `${req.user.nome} marcou como "${estado}"`, ts: Date.now(), por: req.user.nome });
    salvar();
    res.json({ ok: true, estadoCobranca: chat.estadoCobranca });
  });

  /* confirma (ou edita) o acordo que a IA propôs, virando parcelas de verdade */
  app.post("/api/cobranca/chats/:id/acordo/confirmar", auth, (req, res) => {
    const chat = db.waChats[req.params.id];
    if (!chat || chat.canal !== "oficial") return res.status(404).json({ error: "Conversa não encontrada" });
    if (req.user.role !== "gerente" && chat.atendenteId !== req.user.id) return res.status(403).json({ error: "Sem acesso" });
    const b = req.body || {};
    const base = chat.acordoProposto || {};
    const acordo = registrarAcordo(chat, {
      parcelas: b.parcelas ?? base.parcelas, valorParcela: b.valorParcela ?? base.valorParcela,
      vencimento: b.vencimento ?? base.vencimento, criadoPor: req.user.nome,
    });
    chat.acordoProposto = null;
    salvar();
    res.json({ ok: true, acordo });
  });
  /* cria um acordo manualmente (sem passar pela IA) */
  app.post("/api/cobranca/chats/:id/acordo", auth, (req, res) => {
    const chat = db.waChats[req.params.id];
    if (!chat || chat.canal !== "oficial") return res.status(404).json({ error: "Conversa não encontrada" });
    if (req.user.role !== "gerente" && chat.atendenteId !== req.user.id) return res.status(403).json({ error: "Sem acesso" });
    const b = req.body || {};
    if (!b.parcelas || !b.valorParcela || !b.vencimento) return res.status(400).json({ error: "Informe parcelas, valorParcela e vencimento" });
    const acordo = registrarAcordo(chat, { parcelas: b.parcelas, valorParcela: b.valorParcela, vencimento: b.vencimento, criadoPor: req.user.nome });
    salvar();
    res.json({ ok: true, acordo });
  });

  /* ============================================================
     CAMADA 4 — PÓS-ACORDO: listagem, baixa manual de parcela, e o
     "tick" que roda de hora em hora mandando lembrete e detectando quebra
     ============================================================ */
  app.get("/api/cobranca/acordos", auth, gerenteOnly, (req, res) => {
    garantirEstrutura();
    res.json(db.cobranca.acordos || []);
  });
  app.post("/api/cobranca/acordos/:id/parcelas/:numero/pagar", auth, (req, res) => {
    const acordo = (db.cobranca.acordos || []).find((a) => a.id === req.params.id);
    if (!acordo) return res.status(404).json({ error: "Acordo não encontrado" });
    const p = acordo.parcelas.find((x) => x.numero === Number(req.params.numero));
    if (!p) return res.status(404).json({ error: "Parcela não encontrada" });
    p.status = "pago"; p.pagoEm = Date.now();
    const todasPagas = acordo.parcelas.every((x) => x.status === "pago");
    if (todasPagas) {
      acordo.quebrado = false;
      const chat = db.waChats[acordo.chatId];
      if (chat) chat.estadoCobranca = "pago";
    }
    salvar();
    res.json({ ok: true, acordo });
  });

  // varredura periódica: lembrete N dias antes do vencimento, quebra após carência
  async function tick() {
    garantirEstrutura();
    if (!dentroDoHorario()) return; // não manda nada fora do horário comercial
    const cfg = db.cobranca.config;
    const hoje = new Date().toISOString().slice(0, 10);
    for (const acordo of db.cobranca.acordos || []) {
      if (acordo.quebrado) continue;
      const numeroCfg = acharNumero(acordo.numeroOficialId);
      if (!numeroCfg || !numeroCfg.ativo) continue;
      for (const p of acordo.parcelas) {
        if (p.status === "pago") continue;
        const diasParaVencer = Math.floor((new Date(p.vencimento + "T00:00:00-03:00") - new Date(hoje + "T00:00:00-03:00")) / 86400000);
        // lembrete N dias antes (1x só, por parcela)
        if (!p.lembreteEnviadoEm && diasParaVencer <= (cfg.diasAntesLembrete || 2) && diasParaVencer >= 0) {
          if (cfg.templateLembrete) {
            try {
              await enviarTemplate(numeroCfg, acordo.numero, cfg.templateLembrete, "pt_BR", [acordo.nomeAluno || "", fmtMoedaBR(p.valor), fmtDataBR(p.vencimento)]);
              p.lembreteEnviadoEm = Date.now();
              salvar();
            } catch (e) { console.error("[cobranca] falha lembrete:", e.message); }
          } else {
            console.warn("[cobranca] templateLembrete não configurado — pulei o lembrete do acordo", acordo.id);
          }
        }
        // quebra: passou do vencimento + carência e continua pendente
        if (p.status === "pendente" && diasParaVencer < -(cfg.diasCarencia || 2)) {
          p.status = "atrasado";
          acordo.quebrado = true;
          const chat = db.waChats[acordo.chatId];
          if (chat) {
            chat.estadoCobranca = "negociando"; // reabre pro humano decidir o próximo passo
            atribuirAtendente(chat);
            chat.naoLidas = (chat.naoLidas || 0) + 1;
            if (!Array.isArray(chat.notas)) chat.notas = [];
            chat.notas.push({ tipo: "acordo_quebrado", texto: `Parcela ${p.numero} venceu em ${fmtDataBR(p.vencimento)} e não foi paga — acordo quebrado, atendimento reaberto`, ts: Date.now(), por: "Automação Pós-Acordo" });
          }
          if (cfg.templateQuebra) {
            try { await enviarTemplate(numeroCfg, acordo.numero, cfg.templateQuebra, "pt_BR", [acordo.nomeAluno || "", fmtMoedaBR(p.valor)]); } catch (e) { console.error("[cobranca] falha aviso de quebra:", e.message); }
          }
          salvar();
        }
      }
    }
  }

  /* ============================================================
     WEBHOOK (Meta chama aqui quando chega mensagem/status)
     ============================================================ */
  app.get("/api/cobranca/webhook", (req, res) => {
    garantirEstrutura();
    if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === db.cobranca.verifyToken) {
      return res.status(200).send(req.query["hub.challenge"]);
    }
    res.sendStatus(403);
  });

  app.post("/api/cobranca/webhook", async (req, res) => {
    res.sendStatus(200); // a Meta espera 200 rápido — processa em background
    try {
      const entradas = (req.body && req.body.entry) || [];
      for (const entry of entradas) {
        for (const change of entry.changes || []) {
          const val = change.value || {};
          const numeroCfg = (db.cobranca.numeros || []).find((n) => n.phoneNumberId === (val.metadata && val.metadata.phone_number_id));
          for (const m of val.messages || []) {
            if (!numeroCfg) continue;
            const telefone = m.from;
            const chat = acharOuCriarChat(numeroCfg.id, telefone, (val.contacts && val.contacts[0] && val.contacts[0].profile && val.contacts[0].profile.name) || telefone);
            let content = "", midiaTipo = "text", midiaArquivo = "", midiaMime = "", midiaFilename = "", transcricao = "", mediaIdMeta = "";
            if (m.type === "text") content = (m.text && m.text.body) || "";
            else if (m.type === "button") content = (m.button && m.button.text) || "";
            else if (m.type === "interactive") content = (m.interactive && m.interactive.button_reply && m.interactive.button_reply.title) || (m.interactive && m.interactive.list_reply && m.interactive.list_reply.title) || "";
            else {
              midiaTipo = m.type;
              const obj = m[m.type] || {};
              mediaIdMeta = obj.id || "";
              content = obj.caption || (midiaTipo === "audio" ? "🎤 Áudio" : midiaTipo === "image" ? "📷 Foto" : midiaTipo === "video" ? "🎬 Vídeo" : "📄 Documento");
              midiaFilename = obj.filename || "";
            }
            if (mediaIdMeta) {
              try {
                const baixado = await baixarMidiaMeta(numeroCfg, mediaIdMeta);
                if (baixado) {
                  midiaArquivo = baixado.arquivo; midiaMime = baixado.mimetype;
                  if (midiaTipo === "audio") transcricao = await transcreverAudio(baixado.buffer, baixado.mimetype);
                }
              } catch (_) {}
            }
            const ts = m.timestamp ? Number(m.timestamp) * 1000 : Date.now();
            const msgObj = { role: "them", content, ts };
            if (midiaTipo !== "text") {
              msgObj.tipo = midiaTipo; if (midiaArquivo) msgObj.arquivo = midiaArquivo;
              if (midiaMime) msgObj.mimetype = midiaMime; if (midiaFilename) msgObj.filename = midiaFilename;
              msgObj.mid = m.id || ("of" + ts);
            }
            if (transcricao) msgObj.transcricao = transcricao;
            chat.mensagens.push(msgObj);
            chat.ultimaMsgLeadId = m.id || null;
            if (chat.mensagens.length > 300) chat.mensagens = chat.mensagens.slice(-300);
            chat.naoLidas = (chat.naoLidas || 0) + 1;
            chat.atualizadoEm = ts;

            if (chat.origemDisparo && chat.campanhaId && !chat.jaContouResposta) {
              chat.jaContouResposta = true; chat.respondeu = true;
              const camp = (db.cobranca.campanhas || []).find((x) => x.id === chat.campanhaId);
              if (camp) camp.responderam = (camp.responderam || 0) + 1;
            } else if (chat.origemDisparo) chat.respondeu = true;

            const temIA = chat.iaId && !chat.iaPausada;
            if (temIA) rodarIA(chat, numeroCfg);
            else {
              if (chat.divida && chat.estadoCobranca === "nao_contatado") chat.estadoCobranca = "em_conversa";
              if (!chat.atendenteId) atribuirAtendente(chat);
            }
          }
          for (const st of val.statuses || []) {
            const mid = st.id;
            const campId = db.cobranca.msgCampanha && db.cobranca.msgCampanha[mid];
            if (!campId) continue;
            const camp = (db.cobranca.campanhas || []).find((x) => x.id === campId);
            if (!camp) continue;
            const envio = Array.isArray(camp.envios) ? camp.envios.find((e) => e.mid === mid) : null;
            if (st.status === "delivered") { camp.entregues = (camp.entregues || 0) + 1; if (envio) envio.statusEntrega = "entregue"; }
            if (st.status === "read") { camp.lidos = (camp.lidos || 0) + 1; if (envio) envio.statusEntrega = "lido"; }
            if (st.status === "failed") {
              // a Meta aceitou a chamada da API mas NÃO conseguiu entregar de verdade — esse é o erro real
              const erroDetalhe = (st.errors && st.errors[0] && st.errors[0].title) || "Falha na entrega (não especificado pela Meta)";
              if (envio) { envio.statusEntrega = "falhou_entrega"; envio.erro = erroDetalhe; }
              camp.falhas = (camp.falhas || 0) + 1;
            }
          }
        }
      }
      salvar();
    } catch (e) {
      console.error("[cobranca] erro no webhook:", e.message);
    }
  });

  app.get("/api/cobranca/webhook-info", auth, gerenteOnly, (req, res) => {
    garantirEstrutura();
    res.json({ verifyToken: db.cobranca.verifyToken });
  });

  /* ============================================================
     PAINEL — métricas agregadas pro dashboard
     ============================================================ */
  app.get("/api/cobranca/metricas", auth, gerenteOnly, (req, res) => {
    garantirEstrutura();
    const chats = Object.values(db.waChats).filter((c) => c.canal === "oficial");
    const comDivida = chats.filter((c) => c.divida);
    let totalPendente = 0, totalOriginal = 0;
    const porEstado = { nao_contatado: 0, em_conversa: 0, negociando: 0, acordo_fechado: 0, pago: 0, perdido: 0 };
    for (const c of comDivida) {
      const estado = c.estadoCobranca || "nao_contatado";
      if (porEstado[estado] !== undefined) porEstado[estado]++;
      totalOriginal += Number(c.divida.valor) || 0;
      if (estado !== "pago") totalPendente += Number(c.divida.valor) || 0;
    }
    let totalRecuperado = 0, parcelasPendentes = 0, parcelasAtrasadas = 0;
    const acordos = db.cobranca.acordos || [];
    for (const a of acordos) {
      for (const p of a.parcelas) {
        if (p.status === "pago") totalRecuperado += Number(p.valor) || 0;
        else if (p.status === "atrasado") parcelasAtrasadas++;
        else parcelasPendentes++;
      }
    }
    const acordosAtivos = acordos.filter((a) => !a.quebrado && a.parcelas.some((p) => p.status !== "pago")).length;
    const acordosQuebrados = acordos.filter((a) => a.quebrado).length;
    const totalComDivida = comDivida.length || 1;
    const taxaConversao = Math.round(((porEstado.acordo_fechado + porEstado.pago) / totalComDivida) * 100);
    const respondendoIA = chats.filter((c) => c.iaId && !c.iaPausada).length;
    const aguardandoHumano = chats.filter((c) => c.atendenteId && c.iaId && c.iaPausada && !c.encerrado).length;
    res.json({
      totalPendente, totalOriginal, totalRecuperado, porEstado,
      totalContatos: comDivida.length, acordosAtivos, acordosQuebrados,
      parcelasPendentes, parcelasAtrasadas, taxaConversao,
      respondendoIA, aguardandoHumano,
      conversasAtivas: chats.filter((c) => !c.encerrado).length,
    });
  });

  /* ============================================================
     VOZ — configuração de Twilio + ElevenLabs (ligações). Guarda as
     credenciais agora; o motor de discagem/IA de voz entra na próxima etapa.
     ============================================================ */
  function vozPublica(v) {
    return {
      twilioAccountSid: v.twilioAccountSid || "", twilioNumero: v.twilioNumero || "",
      temTwilioToken: !!v.twilioAuthToken,
      elevenAgentId: v.elevenAgentId || "", temElevenKey: !!v.elevenApiKey,
      ativo: !!v.ativo,
    };
  }
  app.get("/api/cobranca/voz-config", auth, gerenteOnly, (req, res) => {
    garantirEstrutura();
    if (!db.cobranca.voz) db.cobranca.voz = {};
    res.json(vozPublica(db.cobranca.voz));
  });
  app.put("/api/cobranca/voz-config", auth, gerenteOnly, (req, res) => {
    garantirEstrutura();
    if (!db.cobranca.voz) db.cobranca.voz = {};
    const v = db.cobranca.voz, b = req.body || {};
    if (b.twilioAccountSid !== undefined) v.twilioAccountSid = lim(b.twilioAccountSid, 100);
    if (b.twilioAuthToken) v.twilioAuthToken = lim(b.twilioAuthToken, 200);
    if (b.twilioNumero !== undefined) v.twilioNumero = lim(b.twilioNumero, 40);
    if (b.elevenApiKey) v.elevenApiKey = lim(b.elevenApiKey, 200);
    if (b.elevenAgentId !== undefined) v.elevenAgentId = lim(b.elevenAgentId, 100);
    if (b.ativo !== undefined) v.ativo = !!b.ativo;
    salvar();
    res.json(vozPublica(v));
  });

  return { tick };
}

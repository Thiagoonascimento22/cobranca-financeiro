import React, { useEffect, useState, useRef, useCallback } from "react";
import { api, getToken, setToken } from "./api.js";

/* parser de CSV simples (sem dependência externa): aceita , ou ; como separador,
   detecta cabeçalho e tolera campos entre aspas */
function parseCSV(texto) {
  const linhas = texto.split(/\r\n|\n|\r/).filter((l) => l.trim().length);
  if (!linhas.length) return { header: [], linhas: [] };
  const sep = linhas[0].includes(";") && !linhas[0].includes(",") ? ";" : ",";
  function parseLinha(l) {
    const out = [];
    let cur = "", dentro = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (ch === '"') { dentro = !dentro; continue; }
      if (ch === sep && !dentro) { out.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    out.push(cur.trim());
    return out;
  }
  const header = parseLinha(linhas[0]).map((h) => h.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
  const linhasDados = linhas.slice(1).map(parseLinha);
  return { header, linhas: linhasDados };
}

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
   IAs — construtor SDR / Negociadora
   ============================================================ */
function configVaziaFront() {
  return {
    tomVoz: "profissional", objetivo: "", quemEla: "", comoEscreve: "", sempreFaz: "", nuncaFaz: "",
    objecoes: [], faq: [],
    pbAbertura: "", pbConfirmacao: "", pbColeta: "", pbNegociacao: "", pbFechamento: "", pbRecuperacao: "",
    escQuando: "", escFrase: "", encerrarCriterios: "",
    formasPagamento: "", parcelamentoMax: 0, descontoMaximoPct: 0, regrasNegociacao: "",
  };
}

function IABuilder({ ia, papelInicial, iasNegociadoras, onClose, onSaved }) {
  const [nome, setNome] = useState(ia ? ia.nome : "");
  const [papel, setPapel] = useState(ia ? ia.papel : (papelInicial || "sdr"));
  const [proximaIaId, setProximaIaId] = useState(ia ? ia.proximaIaId || "" : "");
  const [ativa, setAtiva] = useState(ia ? ia.ativa : true);
  const [c, setC] = useState(ia ? { ...configVaziaFront(), ...ia.config } : configVaziaFront());
  const [conhecimento, setConhecimento] = useState(ia ? ia.conhecimento || [] : []);
  const [novoKb, setNovoKb] = useState({ nome: "", texto: "" });
  const [secao, setSecao] = useState("identidade");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  // teste rápido dentro do construtor
  const [testeHist, setTesteHist] = useState([]);
  const [testeMsg, setTesteMsg] = useState("");
  const [testeDivida, setTesteDivida] = useState({ valor: "890", vencimento: "2026-06-10", codigoAluno: "AL-1234" });
  const [testando, setTestando] = useState(false);

  function set(campo, valor) { setC((prev) => ({ ...prev, [campo]: valor })); }

  const SECOES_SDR = [
    { k: "identidade", lb: "Identificação" },
    { k: "persona", lb: "Persona" },
    { k: "objecoes", lb: "Objeções e FAQ" },
    { k: "playbook", lb: "Roteiro" },
    { k: "escalacao", lb: "Escalação" },
    { k: "conhecimento", lb: "Base de conhecimento" },
    { k: "teste", lb: "Testar" },
  ];
  const SECOES_NEG = [
    { k: "identidade", lb: "Identificação" },
    { k: "persona", lb: "Persona" },
    { k: "negociacao", lb: "Regras de negociação" },
    { k: "objecoes", lb: "Objeções e FAQ" },
    { k: "playbook", lb: "Roteiro" },
    { k: "escalacao", lb: "Escalação" },
    { k: "conhecimento", lb: "Base de conhecimento" },
    { k: "teste", lb: "Testar" },
  ];
  const secoes = papel === "negociadora" ? SECOES_NEG : SECOES_SDR;

  async function salvar() {
    if (!nome.trim()) { setErro("Dê um nome pra IA"); setSecao("identidade"); return; }
    setSalvando(true); setErro("");
    try {
      const payload = { nome, papel, proximaIaId: proximaIaId || null, ativa, config: c, conhecimento };
      if (ia) await api.editarIA(ia.id, payload);
      else await api.criarIA(payload);
      onSaved();
    } catch (e) { setErro(e.message); } finally { setSalvando(false); }
  }

  async function testar() {
    if (!testeMsg.trim()) return;
    const hist = [...testeHist, { role: "them", content: testeMsg }];
    setTesteHist(hist);
    setTesteMsg("");
    setTestando(true);
    try {
      const r = await api.previewIA({ nome, papel, config: c, conhecimento, historico: hist, divida: papel === "negociadora" || papel === "sdr" ? testeDivida : null });
      setTesteHist([...hist, { role: "me", content: r.resposta + (r.passarHumano ? "  [passaria pro humano]" : r.passarNegociadora ? "  [passaria pra negociadora]" : "") }]);
    } catch (e) { setTesteHist([...hist, { role: "me", content: "Erro: " + e.message }]); } finally { setTestando(false); }
  }

  return (
    <div className="agx-overlay">
      <div className="agx-modal">
        <div className="agx-head">
          <div className="agx-head-l">
            <div className="agx-avatar">{papel === "negociadora" ? "N" : "S"}</div>
            <div>
              <div className="agx-title">{ia ? "Editar IA" : "Nova IA"} — {papel === "negociadora" ? "Negociadora" : "SDR"}</div>
              <div className="agx-sub">{papel === "negociadora" ? "Apresenta propostas dentro das regras que você definir" : "Qualifica e entende o motivo da inadimplência"}</div>
            </div>
          </div>
          <div className="agx-head-r">
            {erro && <span style={{ color: "#e5484d", fontSize: 13 }}>{erro}</span>}
            <button className="agx-btn-ghost" onClick={onClose}>Cancelar</button>
            <button className="btn btn-primary" onClick={salvar} disabled={salvando}>{salvando ? "Salvando..." : "Salvar"}</button>
          </div>
        </div>
        <div className="agx-body" style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          <aside className="agx-side" style={{ width: 220, borderRight: "1px solid var(--border,#ececf0)", overflowY: "auto", padding: 12 }}>
            {secoes.map((it) => (
              <button key={it.k} className={"agx-side-item" + (secao === it.k ? " on" : "")} onClick={() => setSecao(it.k)} style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 12px", borderRadius: 8, marginBottom: 4, border: "none", background: secao === it.k ? "var(--bg2,#f4f4f6)" : "transparent", cursor: "pointer" }}>
                {it.lb}
              </button>
            ))}
          </aside>
          <main className="agx-main" style={{ flex: 1, overflowY: "auto", padding: 20 }}>
            {secao === "identidade" && (
              <div>
                <h4 className="agx-h">Identificação</h4>
                <div className="row2">
                  <div className="field"><label>Nome da IA *</label><input className="agx-input" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: SDR Financeiro" /></div>
                  <div className="field"><label>Papel</label>
                    <select className="agx-input" value={papel} onChange={(e) => setPapel(e.target.value)}>
                      <option value="sdr">SDR (qualifica, coleta motivo)</option>
                      <option value="negociadora">Negociadora (propõe pagamento)</option>
                    </select>
                  </div>
                </div>
                {papel === "sdr" && (
                  <div className="field">
                    <label>Encaminha pra qual Negociadora?</label>
                    <select className="agx-input" value={proximaIaId} onChange={(e) => setProximaIaId(e.target.value)}>
                      <option value="">— nenhuma (fica só qualificando, você decide manual) —</option>
                      {iasNegociadoras.map((n) => <option key={n.id} value={n.id}>{n.nome}</option>)}
                    </select>
                  </div>
                )}
                <div className="field">
                  <label>Tom de voz</label>
                  <select className="agx-input" value={c.tomVoz} onChange={(e) => set("tomVoz", e.target.value)}>
                    <option value="profissional">Profissional</option>
                    <option value="amigavel">Amigável e próximo</option>
                    <option value="consultivo">Consultivo</option>
                    <option value="direto">Direto e objetivo</option>
                  </select>
                </div>
                <div className="field"><label>Objetivo principal</label><input className="agx-input" value={c.objetivo} onChange={(e) => set("objetivo", e.target.value)} /></div>
                <div className="field" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={ativa} onChange={(e) => setAtiva(e.target.checked)} /> <label style={{ margin: 0 }}>IA ativa</label>
                </div>
              </div>
            )}
            {secao === "persona" && (
              <div>
                <h4 className="agx-h">Personalidade</h4>
                <div className="field"><label>Quem ela é</label><textarea className="agx-input" rows={4} value={c.quemEla} onChange={(e) => set("quemEla", e.target.value)} /></div>
                <div className="field"><label>Como escreve</label><textarea className="agx-input" rows={3} value={c.comoEscreve} onChange={(e) => set("comoEscreve", e.target.value)} /></div>
                <div className="row2">
                  <div className="field"><label>SEMPRE faz</label><textarea className="agx-input" rows={5} value={c.sempreFaz} onChange={(e) => set("sempreFaz", e.target.value)} /></div>
                  <div className="field"><label>NUNCA faz</label><textarea className="agx-input" rows={5} value={c.nuncaFaz} onChange={(e) => set("nuncaFaz", e.target.value)} /></div>
                </div>
              </div>
            )}
            {secao === "negociacao" && (
              <div>
                <h4 className="agx-h">Limite de autonomia (o "treino" da negociação)</h4>
                <div className="field"><label>Formas de pagamento aceitas</label><input className="agx-input" value={c.formasPagamento} onChange={(e) => set("formasPagamento", e.target.value)} placeholder="Ex: Pix, boleto ou cartão" /></div>
                <div className="row2">
                  <div className="field"><label>Parcelamento máximo sem aprovação humana</label><input className="agx-input" type="number" min="0" max="60" value={c.parcelamentoMax} onChange={(e) => set("parcelamentoMax", Number(e.target.value))} /></div>
                  <div className="field"><label>Desconto máximo à vista (%) sem aprovação</label><input className="agx-input" type="number" min="0" max="100" value={c.descontoMaximoPct} onChange={(e) => set("descontoMaximoPct", Number(e.target.value))} /></div>
                </div>
                <div className="field"><label>Regras extras de negociação</label><textarea className="agx-input" rows={4} value={c.regrasNegociacao} onChange={(e) => set("regrasNegociacao", e.target.value)} placeholder="Ex: nunca oferecer desconto pra quem está a menos de 30 dias de atraso" /></div>
              </div>
            )}
            {secao === "objecoes" && (
              <div>
                <h4 className="agx-h">Objeções</h4>
                {c.objecoes.map((o, i) => (
                  <div className="agx-card" key={i}>
                    <div className="agx-card-top"><span className="agx-card-tag">OBJEÇÃO #{i + 1}</span>
                      <button className="agx-card-x" onClick={() => set("objecoes", c.objecoes.filter((_, idx) => idx !== i))}>×</button>
                    </div>
                    <div className="field"><label>O que o aluno diz</label><input className="agx-input" value={o.objecao || ""} onChange={(e) => set("objecoes", c.objecoes.map((x, idx) => idx === i ? { ...x, objecao: e.target.value } : x))} /></div>
                    <div className="field"><label>Como a IA responde</label><textarea className="agx-input" rows={2} value={o.resposta || ""} onChange={(e) => set("objecoes", c.objecoes.map((x, idx) => idx === i ? { ...x, resposta: e.target.value } : x))} /></div>
                  </div>
                ))}
                <button className="agx-add" onClick={() => set("objecoes", [...c.objecoes, {}])}>+ Adicionar Objeção</button>
                <div className="agx-sep" />
                <h4 className="agx-h">Perguntas frequentes</h4>
                {c.faq.map((q, i) => (
                  <div className="agx-card" key={i}>
                    <div className="agx-card-top"><span className="agx-card-tag">PERGUNTA #{i + 1}</span>
                      <button className="agx-card-x" onClick={() => set("faq", c.faq.filter((_, idx) => idx !== i))}>×</button>
                    </div>
                    <div className="field"><label>Pergunta</label><input className="agx-input" value={q.pergunta || ""} onChange={(e) => set("faq", c.faq.map((x, idx) => idx === i ? { ...x, pergunta: e.target.value } : x))} /></div>
                    <div className="field"><label>Resposta</label><textarea className="agx-input" rows={2} value={q.resposta || ""} onChange={(e) => set("faq", c.faq.map((x, idx) => idx === i ? { ...x, resposta: e.target.value } : x))} /></div>
                  </div>
                ))}
                <button className="agx-add" onClick={() => set("faq", [...c.faq, {}])}>+ Adicionar Pergunta</button>
              </div>
            )}
            {secao === "playbook" && (
              <div>
                <h4 className="agx-h">Roteiro da conversa</h4>
                {papel === "sdr" ? (
                  <>
                    <div className="field"><label>1. Abertura</label><textarea className="agx-input" rows={2} value={c.pbAbertura} onChange={(e) => set("pbAbertura", e.target.value)} /></div>
                    <div className="field"><label>2. Confirmação de identidade</label><textarea className="agx-input" rows={2} value={c.pbConfirmacao} onChange={(e) => set("pbConfirmacao", e.target.value)} /></div>
                    <div className="field"><label>3. Coleta do motivo do atraso</label><textarea className="agx-input" rows={2} value={c.pbColeta} onChange={(e) => set("pbColeta", e.target.value)} /></div>
                    <div className="field"><label>4. Recuperação (se sumir)</label><textarea className="agx-input" rows={2} value={c.pbRecuperacao} onChange={(e) => set("pbRecuperacao", e.target.value)} /></div>
                  </>
                ) : (
                  <>
                    <div className="field"><label>1. Apresentação das opções de pagamento</label><textarea className="agx-input" rows={2} value={c.pbNegociacao} onChange={(e) => set("pbNegociacao", e.target.value)} /></div>
                    <div className="field"><label>2. Fechamento</label><textarea className="agx-input" rows={2} value={c.pbFechamento} onChange={(e) => set("pbFechamento", e.target.value)} /></div>
                    <div className="field"><label>3. Recuperação (se sumir)</label><textarea className="agx-input" rows={2} value={c.pbRecuperacao} onChange={(e) => set("pbRecuperacao", e.target.value)} /></div>
                  </>
                )}
              </div>
            )}
            {secao === "escalacao" && (
              <div>
                <h4 className="agx-h">Quando passar pro humano</h4>
                <div className="field"><label>Critérios extras (além dos padrão: disputa, ameaça, hostilidade)</label><textarea className="agx-input" rows={3} value={c.escQuando} onChange={(e) => set("escQuando", e.target.value)} /></div>
                <div className="field"><label>Frase natural de transição (o aluno não percebe a troca)</label><input className="agx-input" value={c.escFrase} onChange={(e) => set("escFrase", e.target.value)} placeholder='Ex: "Deixa eu confirmar isso com o financeiro e já te retorno"' /></div>
                <div className="field"><label>Quando encerrar / parar de insistir</label><textarea className="agx-input" rows={3} value={c.encerrarCriterios} onChange={(e) => set("encerrarCriterios", e.target.value)} /></div>
              </div>
            )}
            {secao === "conhecimento" && (
              <div>
                <h4 className="agx-h">Base de conhecimento</h4>
                <p className="agx-psub">Cole informações de referência (políticas de cobrança, FAQ interno, etc).</p>
                {conhecimento.map((k) => (
                  <div className="agx-card" key={k.id || k.nome}>
                    <div className="agx-card-top"><span className="agx-card-tag">{k.nome}</span>
                      <button className="agx-card-x" onClick={() => setConhecimento(conhecimento.filter((x) => x !== k))}>×</button>
                    </div>
                  </div>
                ))}
                <div className="row2">
                  <div className="field"><label>Título</label><input className="agx-input" value={novoKb.nome} onChange={(e) => setNovoKb({ ...novoKb, nome: e.target.value })} /></div>
                </div>
                <div className="field"><label>Texto</label><textarea className="agx-input" rows={4} value={novoKb.texto} onChange={(e) => setNovoKb({ ...novoKb, texto: e.target.value })} /></div>
                <button className="agx-add" onClick={() => { if (novoKb.nome && novoKb.texto) { setConhecimento([...conhecimento, { ...novoKb }]); setNovoKb({ nome: "", texto: "" }); } }}>+ Adicionar</button>
              </div>
            )}
            {secao === "teste" && (
              <div>
                <h4 className="agx-h">Testar a IA</h4>
                <p className="agx-psub">Simula uma conversa sem mandar WhatsApp de verdade.</p>
                <div className="row2">
                  <div className="field"><label>Valor da dívida (teste)</label><input className="agx-input" value={testeDivida.valor} onChange={(e) => setTesteDivida({ ...testeDivida, valor: e.target.value })} /></div>
                  <div className="field"><label>Vencimento (teste)</label><input className="agx-input" type="date" value={testeDivida.vencimento} onChange={(e) => setTesteDivida({ ...testeDivida, vencimento: e.target.value })} /></div>
                </div>
                <div style={{ border: "1px solid var(--border,#ececf0)", borderRadius: 10, padding: 12, minHeight: 200, marginBottom: 10 }}>
                  {testeHist.length === 0 && <div className="col-empty">Manda uma mensagem como se fosse o aluno.</div>}
                  {testeHist.map((m, i) => (
                    <div key={i} className={"wa-bubble " + (m.role === "me" ? "me" : "them")} style={{ marginBottom: 8 }}>{m.content}</div>
                  ))}
                </div>
                <div className="wa-input" style={{ position: "static" }}>
                  <input placeholder="Escreva como o aluno..." value={testeMsg} onChange={(e) => setTesteMsg(e.target.value)} onKeyDown={(e) => e.key === "Enter" && testar()} />
                  <button className="wa-send" onClick={testar} disabled={testando}>{testando ? "..." : "Enviar"}</button>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

function IAsScreen() {
  const [lista, setLista] = useState([]);
  const [editando, setEditando] = useState(null); // ia sendo editada, ou {} pra nova
  const [criandoPapel, setCriandoPapel] = useState("sdr");
  const [globalAtiva, setGlobalAtiva] = useState(true);

  async function carregar() {
    try { setLista(await api.ias()); } catch (_) {}
    try { setGlobalAtiva((await api.iaGlobal()).ativa); } catch (_) {}
  }
  useEffect(() => { carregar(); }, []);

  async function excluir(id) { if (!confirm("Excluir essa IA?")) return; await api.excluirIA(id); carregar(); }
  async function toggleGlobal() {
    const novo = !globalAtiva;
    setGlobalAtiva(novo);
    await api.setIaGlobal(novo);
  }

  const negociadoras = lista.filter((i) => i.papel === "negociadora");

  return (
    <div className="content">
      <div className="panel">
        <div className="panel-h">
          <h3>Botão de pânico</h3>
          <button className={"btn btn-sm " + (globalAtiva ? "btn-danger" : "btn-primary")} onClick={toggleGlobal}>
            {globalAtiva ? "Desligar todas as IAs agora" : "Religar as IAs"}
          </button>
        </div>
        <p className="agx-psub" style={{ padding: "0 16px 12px" }}>{globalAtiva ? "As IAs estão respondendo normalmente." : "Todas as IAs estão pausadas — nenhuma responde até você religar."}</p>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-h">
          <h3>Suas IAs</h3>
          <div style={{ display: "flex", gap: 8 }}>
            <select className="select" value={criandoPapel} onChange={(e) => setCriandoPapel(e.target.value)}>
              <option value="sdr">Nova SDR</option>
              <option value="negociadora">Nova Negociadora</option>
            </select>
            <button className="btn btn-primary btn-sm" onClick={() => setEditando({ novo: true, papel: criandoPapel })}>+ Criar</button>
          </div>
        </div>
        {lista.map((ia) => (
          <div className="urow" key={ia.id}>
            <div className="info">
              <div className="nm">{ia.nome} {!ia.ativa && <span className="tag-off off">pausada</span>}</div>
              <div className="sub">{ia.papel === "negociadora" ? "Negociadora" : "SDR"}{ia.papel === "sdr" && ia.proximaIaId ? " → encaminha pra " + (lista.find((x) => x.id === ia.proximaIaId)?.nome || "?") : ""}</div>
            </div>
            <button className="btn btn-sm btn-ghost" onClick={() => setEditando(ia)}>Editar</button>
            <button className="btn btn-sm btn-danger" onClick={() => excluir(ia.id)}>Excluir</button>
          </div>
        ))}
        {lista.length === 0 && <div className="col-empty">Nenhuma IA criada ainda. Comece pela SDR.</div>}
      </div>

      {editando && (
        <IABuilder
          ia={editando.novo ? null : editando}
          papelInicial={editando.papel}
          iasNegociadoras={negociadoras}
          onClose={() => setEditando(null)}
          onSaved={() => { setEditando(null); carregar(); }}
        />
      )}
    </div>
  );
}


/* ============================================================
   DISPARO EM MASSA — CSV com nome, telefone, valor, vencimento, código
   ============================================================ */
function DisparoScreen() {
  const [numeros, setNumeros] = useState([]);
  const [ias, setIas] = useState([]);
  const [campanhas, setCampanhas] = useState([]);
  const [numeroId, setNumeroId] = useState("");
  const [templates, setTemplates] = useState([]);
  const [template, setTemplate] = useState("");
  const [iaId, setIaId] = useState("");
  const [nomeCampanha, setNomeCampanha] = useState("");
  const [contatos, setContatos] = useState([]);
  const [arquivoNome, setArquivoNome] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const fileRef = useRef(null);

  async function carregar() {
    try { setNumeros(await api.numeros()); } catch (_) {}
    try { setIas((await api.ias()).filter((i) => i.ativa)); } catch (_) {}
    try { setCampanhas(await api.campanhas()); } catch (_) {}
  }
  useEffect(() => { carregar(); }, []);

  useEffect(() => {
    if (!numeroId) { setTemplates([]); return; }
    api.templates(numeroId).then((r) => setTemplates(r.templates || [])).catch(() => setTemplates([]));
  }, [numeroId]);

  function onArquivo(e) {
    const f = e.target.files[0];
    if (!f) return;
    setArquivoNome(f.name);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const { header, linhas } = parseCSV(String(reader.result));
        const idxNome = header.findIndex((h) => h.includes("nome"));
        const idxTel = header.findIndex((h) => h.includes("telefone") || h.includes("celular") || h.includes("whats"));
        const idxValor = header.findIndex((h) => h.includes("valor"));
        const idxVenc = header.findIndex((h) => h.includes("vencimento") || h.includes("venc"));
        const idxCod = header.findIndex((h) => h.includes("codigo") || h.includes("matricula"));
        if (idxTel < 0) { setErro("Não achei a coluna de telefone no CSV. Cabeçalho encontrado: " + header.join(", ")); return; }
        const out = linhas.map((l) => ({
          nome: idxNome >= 0 ? l[idxNome] : "",
          telefone: l[idxTel],
          divida: {
            valor: idxValor >= 0 ? l[idxValor].replace(",", ".") : "",
            vencimento: idxVenc >= 0 ? l[idxVenc] : "",
            codigoAluno: idxCod >= 0 ? l[idxCod] : "",
          },
        })).filter((c) => c.telefone);
        setContatos(out);
        setErro("");
      } catch (e) { setErro("Erro ao ler o CSV: " + e.message); }
    };
    reader.readAsText(f, "utf-8");
  }

  async function disparar() {
    setErro("");
    if (!numeroId) return setErro("Escolha um número");
    if (!template) return setErro("Escolha um template aprovado");
    if (!contatos.length) return setErro("Importe o CSV primeiro");
    setEnviando(true);
    try {
      await api.disparar({ numeroId, template, iaId: iaId || null, nomeCampanha: nomeCampanha || template, contatos });
      setContatos([]); setArquivoNome(""); setNomeCampanha("");
      if (fileRef.current) fileRef.current.value = "";
      carregar();
    } catch (e) { setErro(e.message); } finally { setEnviando(false); }
  }

  return (
    <div className="content">
      <div className="panel">
        <div className="panel-h"><h3>Nova campanha de cobrança</h3></div>
        <div style={{ padding: 16 }}>
          <div className="row2">
            <div className="field"><label>Número</label>
              <select className="select" value={numeroId} onChange={(e) => setNumeroId(e.target.value)}>
                <option value="">Selecione</option>
                {numeros.map((n) => <option key={n.id} value={n.id}>{n.apelido}</option>)}
              </select>
            </div>
            <div className="field"><label>Template aprovado (Meta)</label>
              <select className="select" value={template} onChange={(e) => setTemplate(e.target.value)}>
                <option value="">Selecione</option>
                {templates.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
              </select>
            </div>
          </div>
          <div className="row2">
            <div className="field"><label>IA que assume quando o aluno responder</label>
              <select className="select" value={iaId} onChange={(e) => setIaId(e.target.value)}>
                <option value="">Nenhuma (vai direto pro atendente humano)</option>
                {ias.map((i) => <option key={i.id} value={i.id}>{i.nome} ({i.papel})</option>)}
              </select>
            </div>
            <div className="field"><label>Nome da campanha</label><input className="input" value={nomeCampanha} onChange={(e) => setNomeCampanha(e.target.value)} placeholder="Ex: Cobrança julho/2026" /></div>
          </div>
          <div className="field">
            <label>CSV da base (colunas: nome, telefone, valor, vencimento, código do aluno)</label>
            <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onArquivo} />
            {arquivoNome && <div className="agx-psub">{arquivoNome} — {contatos.length} contato(s) reconhecido(s)</div>}
          </div>
          {erro && <div className="err">{erro}</div>}
          <button className="btn btn-primary" disabled={enviando} onClick={disparar}>{enviando ? "Disparando..." : `Disparar pra ${contatos.length} contato(s)`}</button>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-h"><h3>Campanhas</h3></div>
        {campanhas.map((c) => (
          <div className="urow" key={c.id}>
            <div className="info"><div className="nm">{c.nome}</div><div className="sub">{c.enviados}/{c.total} enviados · {c.responderam} responderam · {c.falhas} falhas · {c.status}</div></div>
            {c.pendentesCount > 0 && <button className="btn btn-sm" onClick={() => api.retomarCampanha(c.id).then(carregar)}>Retomar</button>}
          </div>
        ))}
        {campanhas.length === 0 && <div className="col-empty">Nenhuma campanha disparada ainda.</div>}
      </div>
    </div>
  );
}

/* ============================================================
   ACORDOS — automação pós-acordo (parcelas, lembretes, quebra)
   ============================================================ */
function AcordosScreen() {
  const [lista, setLista] = useState([]);
  async function carregar() { try { setLista(await api.acordos()); } catch (_) {} }
  useEffect(() => { carregar(); const t = setInterval(carregar, 15000); return () => clearInterval(t); }, []);

  async function pagar(acordoId, numero) {
    await api.pagarParcela(acordoId, numero);
    carregar();
  }

  return (
    <div className="content">
      <div className="panel">
        <div className="panel-h"><h3>Acordos fechados</h3></div>
        {lista.map((a) => (
          <div key={a.id} style={{ padding: 14, borderBottom: "1px solid var(--border,#ececf0)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <div><strong>{a.nomeAluno}</strong> <span className="sub">{a.numero}</span></div>
              {a.quebrado && <span className="tag-off off">acordo quebrado</span>}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {a.parcelas.map((p) => (
                <div key={p.numero} className={"kcard"} style={{ minWidth: 140 }}>
                  <div className="nm">Parcela {p.numero}</div>
                  <div className="val">{Number(p.valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</div>
                  <div className="meta">venc. {p.vencimento}</div>
                  <div className="meta">status: {p.status}</div>
                  {p.status !== "pago" && <button className="btn btn-sm btn-primary" style={{ marginTop: 6 }} onClick={() => pagar(a.id, p.numero)}>Marcar como pago</button>}
                </div>
              ))}
            </div>
          </div>
        ))}
        {lista.length === 0 && <div className="col-empty">Nenhum acordo registrado ainda.</div>}
      </div>
    </div>
  );
}

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
        {secao === "ias" && <IAsScreen />}
        {secao === "disparo" && <DisparoScreen />}
        {secao === "acordos" && <AcordosScreen />}
      </main>
    </div>
  );
}

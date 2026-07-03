import React, { useEffect, useState, useRef, useCallback } from "react";
import { api, getToken, setToken } from "./api.js";

/* ============================================================
   ÍCONES (SVG inline, sem emoji)
   ============================================================ */
const I = {
  dash: (p) => (<svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><rect x="7" y="11" width="3" height="6" rx="1" /><rect x="12" y="7" width="3" height="10" rx="1" /><rect x="17" y="13" width="3" height="4" rx="1" /></svg>),
  chat: (p) => (<svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>),
  spark: (p) => (<svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" /></svg>),
  send: (p) => (<svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>),
  cash: (p) => (<svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></svg>),
  pipe: (p) => (<svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="6" height="14" rx="1" /><rect x="9.5" y="3" width="6" height="9" rx="1" /><rect x="16" y="3" width="5" height="6" rx="1" /></svg>),
  team: (p) => (<svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>),
  phone: (p) => (<svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.36 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" /></svg>),
  sun: (p) => (<svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4" /></svg>),
  moon: (p) => (<svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>),
  down: (p) => (<svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>),
  plus: (p) => (<svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>),
  x: (p) => (<svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>),
  trash: (p) => (<svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>),
  upload: (p) => (<svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" /></svg>),
  trend: (p) => (<svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 7h6v6" /><path d="m22 7-8.5 8.5-5-5L2 17" /></svg>),
  clock: (p) => (<svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>),
  alert: (p) => (<svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4M12 17h.01" /></svg>),
  check: (p) => (<svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.8 10A10 10 0 1 1 17 3.3" /><path d="m9 11 3 3L22 4" /></svg>),
  cog: (p) => (<svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>),
  doc: (p) => (<svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h8M8 9h2" /></svg>),
};

/* parser de CSV simples (sem dependência externa) */
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

function fmtMoeda(v) {
  return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/* botão flutuante de "rolar para o fim", aparece quando o container não está no fundo */
function useScrollFab(ref, deps) {
  const [mostrar, setMostrar] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    function onScroll() {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      setMostrar(dist > 120);
    }
    el.addEventListener("scroll", onScroll);
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, deps);
  function irParaBaixo() {
    const el = ref.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }
  return [mostrar, irParaBaixo];
}
function ScrollFab({ show, onClick }) {
  if (!show) return null;
  return (
    <button className="scroll-fab" onClick={onClick} aria-label="Rolar para o fim">
      <I.down />
    </button>
  );
}

/* modal genérico e leve, reutilizado em Números/Equipe pra ações de criar */
function Modal({ titulo, subtitulo, onClose, children, largura }) {
  return (
    <div className="agx-overlay" onClick={onClose}>
      <div className="modal-box" style={{ width: largura || 480, maxWidth: "92vw" }} onClick={(e) => e.stopPropagation()}>
        <div className="mh">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <h3 style={{ margin: 0 }}>{titulo}</h3>
              {subtitulo && <p style={{ margin: "4px 0 0" }}>{subtitulo}</p>}
            </div>
            <button className="agx-x" onClick={onClose}><I.x style={{ width: 16, height: 16 }} /></button>
          </div>
        </div>
        <div className="mb">{children}</div>
      </div>
    </div>
  );
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
        <div className="logo-infinite" style={{ width: 76, height: 76, margin: "0 auto 10px" }}>
          <img src="/logo.png" alt="Instructiva" style={{ width: 64, height: 64, objectFit: "contain", display: "block" }} />
        </div>
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
   PAINEL — dashboard com métricas principais
   ============================================================ */
const ESTADOS_LABEL = {
  nao_contatado: "Não contatado", em_conversa: "Em conversa", negociando: "Negociando",
  acordo_fechado: "Acordo fechado", pago: "Pago", perdido: "Perdido",
};
const ESTADOS_COR = {
  nao_contatado: "var(--faint)", em_conversa: "var(--cyan)", negociando: "var(--amber)",
  acordo_fechado: "var(--indigo-600)", pago: "var(--mint)", perdido: "var(--coral)",
};

function PainelScreen() {
  const [m, setM] = useState(null);
  useEffect(() => {
    let cancelado = false;
    function carregar() { api.metricas().then((r) => { if (!cancelado) setM(r); }).catch(() => {}); }
    carregar();
    const t = setInterval(carregar, 20000);
    return () => { cancelado = true; clearInterval(t); };
  }, []);

  if (!m) return <div className="content"><div className="spin" /></div>;

  const totalFunil = Object.values(m.porEstado).reduce((s, v) => s + v, 0) || 1;

  return (
    <div className="content">
      <div className="page-head">
        <div><h2>Painel</h2><p>Visão geral da cobrança em tempo real.</p></div>
      </div>
      <div className="dash-grid">
        <div className="dash-card warn">
          <div className="ic-wrap"><I.cash /></div>
          <div className="lab">Valor pendente</div>
          <div className="val money">{fmtMoeda(m.totalPendente)}</div>
          <div className="sub">de {fmtMoeda(m.totalOriginal)} em cobrança</div>
        </div>
        <div className="dash-card good">
          <div className="ic-wrap"><I.trend /></div>
          <div className="lab">Já recuperado</div>
          <div className="val money">{fmtMoeda(m.totalRecuperado)}</div>
          <div className="sub">parcelas pagas de acordos</div>
        </div>
        <div className="dash-card">
          <div className="ic-wrap"><I.check /></div>
          <div className="lab">Taxa de conversão</div>
          <div className="val">{m.taxaConversao}%</div>
          <div className="sub">de {m.totalContatos} contato(s) com dívida</div>
        </div>
        <div className="dash-card">
          <div className="ic-wrap"><I.chat /></div>
          <div className="lab">Conversas ativas</div>
          <div className="val">{m.conversasAtivas}</div>
          <div className="sub">{m.respondendoIA} com IA · {m.aguardandoHumano} aguardando humano</div>
        </div>
        <div className="dash-card">
          <div className="ic-wrap"><I.clock /></div>
          <div className="lab">Acordos ativos</div>
          <div className="val">{m.acordosAtivos}</div>
          <div className="sub">{m.parcelasPendentes} parcela(s) pendente(s)</div>
        </div>
        <div className="dash-card warn">
          <div className="ic-wrap"><I.alert /></div>
          <div className="lab">Acordos quebrados</div>
          <div className="val">{m.acordosQuebrados}</div>
          <div className="sub">{m.parcelasAtrasadas} parcela(s) em atraso</div>
        </div>
        <div className="dash-card warn">
          <div className="ic-wrap"><I.alert /></div>
          <div className="lab">Vencidos sem acordo</div>
          <div className="val">{m.vencidosSemAcordo}</div>
          <div className="sub">passou o prazo original, ninguém negociou</div>
        </div>
      </div>

      <div className="funnel-panel">
        <h3>Funil de cobrança</h3>
        {Object.keys(ESTADOS_LABEL).map((k) => (
          <div className="funnel-row" key={k}>
            <div className="fn-lab">{ESTADOS_LABEL[k]}</div>
            <div className="fn-bar-wrap"><div className="fn-bar" style={{ width: `${(m.porEstado[k] / totalFunil) * 100}%`, background: ESTADOS_COR[k] }} /></div>
            <div className="fn-val">{m.porEstado[k]}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   CONVERSAS — lista + chat (canal oficial)
   ============================================================ */
function Conversas() {
  const [lista, setLista] = useState([]);
  const [ativoId, setAtivoId] = useState(null);
  const [chat, setChat] = useState(null);
  const [texto, setTexto] = useState("");
  const [busca, setBusca] = useState("");
  const [ias, setIas] = useState([]);
  const [ligando, setLigando] = useState(false);
  const msgsRef = useRef(null);
  const [showFab, irParaBaixo] = useScrollFab(msgsRef, [chat && chat.mensagens && chat.mensagens.length]);

  const carregarLista = useCallback(async () => {
    try { setLista(await api.chats(busca)); } catch (_) {}
  }, [busca]);

  useEffect(() => {
    carregarLista();
    const t = setInterval(carregarLista, 6000);
    return () => clearInterval(t);
  }, [carregarLista]);

  useEffect(() => { api.ias().then((r) => setIas(r.filter((i) => i.ativa))).catch(() => {}); }, []);

  useEffect(() => {
    if (!ativoId) return;
    let cancelado = false;
    api.chat(ativoId).then((c) => { if (!cancelado) setChat(c); }).catch(() => {});
    const t = setInterval(() => api.chat(ativoId).then((c) => { if (!cancelado) setChat(c); }).catch(() => {}), 4000);
    return () => { cancelado = true; clearInterval(t); };
  }, [ativoId]);

  useEffect(() => {
    if (msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight;
  }, [chat && chat.mensagens && chat.mensagens.length]);

  async function enviar() {
    if (!texto.trim() || !ativoId) return;
    const t = texto;
    setTexto("");
    try {
      await api.enviar(ativoId, t);
      setChat(await api.chat(ativoId));
    } catch (e) { alert(e.message); }
  }

  async function mudarEstado(estado) {
    if (!ativoId) return;
    try { await api.setEstadoCobranca(ativoId, estado); setChat(await api.chat(ativoId)); carregarLista(); } catch (e) { alert(e.message); }
  }

  async function mudarIA(iaId) {
    if (!ativoId) return;
    try { await api.atribuirIAChat(ativoId, iaId); setChat(await api.chat(ativoId)); carregarLista(); } catch (e) { alert(e.message); }
  }

  async function ligar() {
    if (!ativoId) return;
    setLigando(true);
    try {
      await api.ligar(ativoId);
      setChat(await api.chat(ativoId));
    } catch (e) { alert(e.message); } finally { setLigando(false); }
  }

  async function excluirConversa(id, e) {
    e.stopPropagation();
    if (!confirm("Excluir essa conversa? As mensagens somem pra sempre.")) return;
    try {
      await api.excluirChat(id);
      if (ativoId === id) { setAtivoId(null); setChat(null); }
      carregarLista();
    } catch (e) { alert(e.message); }
  }

  return (
    <div className="wa-page">
      <div className="wa-grid">
        <div className="wa-list">
          <div className="wa-list-h">
            <div className="wa-search"><input placeholder="Buscar nome ou número" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
          </div>
          <div className="wa-list-scroll">
            {lista.length === 0 && <div className="cob-empty">Nenhuma conversa ainda.</div>}
            {lista.map((c) => (
              <div key={c.id} className={"wa-conv" + (c.id === ativoId ? " active" : "")} onClick={() => setAtivoId(c.id)}>
                <div className="av">{(c.nome || "?").slice(0, 1).toUpperCase()}</div>
                <div className="mid">
                  <div className="nm">{c.nome}{c.divida && c.divida.valor ? ` — ${fmtMoeda(c.divida.valor)}` : ""}</div>
                  <div className="last">
                    {c.vencimentoEstourado && <span className="estado-badge perdido" style={{ marginRight: 6 }}>⚠ vencido s/ acordo</span>}
                    {c.estadoCobranca && <span className={"estado-badge " + c.estadoCobranca} style={{ marginRight: 6 }}>{ESTADOS_LABEL[c.estadoCobranca] || c.estadoCobranca}</span>}
                    {c.ultima ? c.ultima.content : "—"}
                  </div>
                </div>
                {c.naoLidas > 0 && <div className="wa-badge">{c.naoLidas}</div>}
                <button className="btn btn-sm btn-ghost" style={{ color: "var(--coral)", flexShrink: 0 }} onClick={(e) => excluirConversa(c.id, e)}><I.trash style={{ width: 13, height: 13 }} /></button>
              </div>
            ))}
          </div>
        </div>

        <div className="wa-chat" style={{ position: "relative" }}>
          {!chat ? (
            <div className="wa-none"><I.chat className="ico" style={{ width: 40, height: 40 }} />Selecione uma conversa</div>
          ) : (
            <>
              <div className="wa-chat-h">
                <div className="av">{(chat.nome || "?").slice(0, 1).toUpperCase()}</div>
                <div>
                  <div className="nm">{chat.nome}</div>
                  <div className="num">{chat.numero}{chat.divida && chat.divida.vencimento ? ` · venc. ${chat.divida.vencimento}` : ""}</div>
                </div>
                <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                  <button className="btn btn-sm btn-ghost" disabled={ligando} onClick={ligar} title="Ligar por voz (IA)"><I.phone style={{ width: 14, height: 14 }} /> {ligando ? "Ligando..." : "Ligar"}</button>
                  <select className="select" value={chat.iaId || ""} onChange={(e) => mudarIA(e.target.value)} title="Qual IA cuida dessa conversa">
                    <option value="">Sem IA (humano)</option>
                    {ias.map((i) => <option key={i.id} value={i.id}>{i.nome} ({i.papel})</option>)}
                  </select>
                  <select className="select" value={chat.estadoCobranca || "nao_contatado"} onChange={(e) => mudarEstado(e.target.value)}>
                    {Object.keys(ESTADOS_LABEL).map((k) => <option key={k} value={k}>{ESTADOS_LABEL[k]}</option>)}
                  </select>
                </div>
              </div>
              <div className="wa-msgs" ref={msgsRef}>
                {(chat.mensagens || []).map((m, i) => (
                  <div key={i} className={"wa-bubble " + (m.role === "me" ? "me" : "them")}>
                    {m.content}
                    <div className="t">{new Date(m.ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}{m.porIA ? " · IA" : ""}</div>
                  </div>
                ))}
              </div>
              <ScrollFab show={showFab} onClick={irParaBaixo} />
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
  const [ias, setIas] = useState([]);
  const [form, setForm] = useState({ apelido: "", numero: "", phoneNumberId: "", wabaId: "", token: "", iaDefaultId: "" });
  const [salvando, setSalvando] = useState(false);
  const [webhookInfo, setWebhookInfo] = useState(null);
  const [modalAberto, setModalAberto] = useState(false);
  const [erro, setErro] = useState("");

  async function carregar() {
    try { setLista(await api.numeros()); } catch (_) {}
    try { setWebhookInfo(await api.webhookInfo()); } catch (_) {}
    try { setIas((await api.ias()).filter((i) => i.ativa)); } catch (_) {}
  }
  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 8000); // pega a foto de perfil assim que o backend termina de buscar
    return () => clearInterval(t);
  }, []);

  async function criar(e) {
    e.preventDefault();
    setErro("");
    setSalvando(true);
    try {
      await api.criarNumero(form);
      setForm({ apelido: "", numero: "", phoneNumberId: "", wabaId: "", token: "", iaDefaultId: "" });
      setModalAberto(false);
      carregar();
    } catch (e) { setErro(e.message); } finally { setSalvando(false); }
  }
  async function excluir(id) {
    if (!confirm("Remover esse número?")) return;
    await api.excluirNumero(id);
    carregar();
  }
  async function mudarIaDefault(id, iaDefaultId) {
    try { await api.editarNumero(id, { iaDefaultId: iaDefaultId || null }); carregar(); } catch (e) { alert(e.message); }
  }

  const urlWebhook = typeof window !== "undefined" ? window.location.origin + "/api/cobranca/webhook" : "";

  return (
    <div className="content">
      <div className="page-head">
        <div><h2>Números</h2><p>Números do WhatsApp conectados ao sistema de cobrança.</p></div>
        <button className="btn btn-primary" onClick={() => setModalAberto(true)}><I.plus style={{ width: 15, height: 15 }} /> Conectar número</button>
      </div>

      <div className="dash-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
        {lista.map((n) => (
          <div className="cob-card" key={n.id} style={{ marginBottom: 0, padding: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {n.fotoPerfilUrl ? (
                <img src={n.fotoPerfilUrl} alt={n.apelido} style={{ width: 48, height: 48, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
              ) : (
                <div className="avatar" style={{ width: 48, height: 48, fontSize: 18 }}>{(n.apelido || "?").slice(0, 1).toUpperCase()}</div>
              )}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700, color: "var(--text)", fontSize: 14.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.apelido}</div>
                <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{n.numero || n.phoneNumberId}</div>
              </div>
              <span className={"cob-pill " + (n.ativo ? "on" : "off")}>{n.ativo ? "ativo" : "inativo"}</span>
            </div>
            <div className="field" style={{ marginTop: 14, marginBottom: 8 }}>
              <label style={{ fontSize: 12 }}>IA padrão (responde quem chegar sem disparo)</label>
              <select className="select" value={n.iaDefaultId || ""} onChange={(e) => mudarIaDefault(n.id, e.target.value)}>
                <option value="">Nenhuma — vai direto pro atendente humano</option>
                {ias.map((i) => <option key={i.id} value={i.id}>{i.nome} ({i.papel})</option>)}
              </select>
            </div>
            <button className="btn btn-sm btn-ghost" style={{ width: "100%", color: "var(--coral)" }} onClick={() => excluir(n.id)}>Remover</button>
          </div>
        ))}
      </div>
      {lista.length === 0 && (
        <div className="cob-card"><div className="cob-empty">Nenhum número cadastrado ainda — clica em "Conectar número" ali em cima.</div></div>
      )}

      <div className="cob-card" style={{ marginTop: 8 }}>
        <div className="cob-card-h"><h3>Webhook (configurar na Meta)</h3></div>
        <div className="cob-card-body">
          <div className="row2">
            <div className="field"><label>URL do webhook</label><input className="input" readOnly value={urlWebhook} onClick={(e) => e.target.select()} /></div>
            <div className="field"><label>Verify Token</label><input className="input" readOnly value={webhookInfo ? webhookInfo.verifyToken : "..."} onClick={(e) => e.target.select()} /></div>
          </div>
          <p className="agx-psub" style={{ marginBottom: 0 }}>Cole esses dois valores em Meta for Developers → seu app → WhatsApp → Configuration → Webhook.</p>
        </div>
      </div>

      {modalAberto && (
        <Modal titulo="Conectar número" subtitulo="Cole os dados desse número, vindos do Meta for Developers." onClose={() => setModalAberto(false)}>
          <form onSubmit={criar}>
            <div className="field"><label>Apelido</label><input className="input" value={form.apelido} onChange={(e) => setForm({ ...form, apelido: e.target.value })} placeholder="Ex: Financeiro Cobrança" autoFocus /></div>
            <div className="field"><label>Número (visual)</label><input className="input" value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} placeholder="Ex: 44 9 9999-0000" /></div>
            <div className="field"><label>Phone Number ID (Meta)</label><input className="input" value={form.phoneNumberId} onChange={(e) => setForm({ ...form, phoneNumberId: e.target.value })} /></div>
            <div className="field"><label>WABA ID</label><input className="input" value={form.wabaId} onChange={(e) => setForm({ ...form, wabaId: e.target.value })} /></div>
            <div className="field"><label>Token de acesso permanente</label><input className="input" type="password" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} /></div>
            <div className="field"><label>IA padrão (opcional)</label>
              <select className="select" value={form.iaDefaultId} onChange={(e) => setForm({ ...form, iaDefaultId: e.target.value })}>
                <option value="">Nenhuma — vai direto pro atendente humano</option>
                {ias.map((i) => <option key={i.id} value={i.id}>{i.nome} ({i.papel})</option>)}
              </select>
            </div>
            {erro && <div className="err">{erro}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
              <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setModalAberto(false)}>Cancelar</button>
              <button className="btn btn-primary" style={{ flex: 1 }} disabled={salvando}>{salvando ? "Conectando..." : "Conectar"}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ============================================================
   EQUIPE
   ============================================================ */
function Equipe() {
  const [lista, setLista] = useState([]);
  const [form, setForm] = useState({ nome: "", login: "", senha: "", role: "atendente" });
  const [modalAberto, setModalAberto] = useState(false);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function carregar() { try { setLista(await api.listUsers()); } catch (_) {} }
  useEffect(() => { carregar(); }, []);

  async function criar(e) {
    e.preventDefault();
    setErro(""); setSalvando(true);
    try {
      await api.createUser(form);
      setForm({ nome: "", login: "", senha: "", role: "atendente" });
      setModalAberto(false);
      carregar();
    } catch (e) { setErro(e.message); } finally { setSalvando(false); }
  }
  async function excluir(id) { if (!confirm("Remover esse usuário?")) return; await api.deleteUser(id); carregar(); }

  return (
    <div className="content">
      <div className="page-head">
        <div><h2>Equipe</h2><p>Quem tem acesso ao sistema de cobrança.</p></div>
        <button className="btn btn-primary" onClick={() => setModalAberto(true)}><I.plus style={{ width: 15, height: 15 }} /> Adicionar pessoa</button>
      </div>

      <div className="cob-card">
        {lista.map((u) => (
          <div className="cob-row" key={u.id}>
            <div className="avatar" style={{ width: 36, height: 36, fontSize: 14, marginRight: 12 }}>{(u.nome || "?").slice(0, 1).toUpperCase()}</div>
            <div className="info"><div className="nm">{u.nome}</div><div className="sub">@{u.login}</div></div>
            <span className={"cob-pill " + (u.role === "gerente" ? "on" : "off")}>{u.role}</span>
            <button className="btn btn-sm btn-ghost" style={{ color: "var(--coral)" }} onClick={() => excluir(u.id)}><I.trash style={{ width: 14, height: 14 }} /></button>
          </div>
        ))}
        {lista.length === 0 && <div className="cob-empty">Ninguém cadastrado ainda além de você.</div>}
      </div>

      {modalAberto && (
        <Modal titulo="Adicionar pessoa" onClose={() => setModalAberto(false)}>
          <form onSubmit={criar}>
            <div className="field"><label>Nome</label><input className="input" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} autoFocus /></div>
            <div className="field"><label>Login</label><input className="input" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} /></div>
            <div className="field"><label>Senha</label><input className="input" type="password" value={form.senha} onChange={(e) => setForm({ ...form, senha: e.target.value })} /></div>
            <div className="field"><label>Papel</label>
              <select className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="atendente">Atendente</option>
                <option value="gerente">Gerente</option>
              </select>
            </div>
            {erro && <div className="err">{erro}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
              <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setModalAberto(false)}>Cancelar</button>
              <button className="btn btn-primary" style={{ flex: 1 }} disabled={salvando}>{salvando ? "Adicionando..." : "Adicionar"}</button>
            </div>
          </form>
        </Modal>
      )}
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

  const [testeHist, setTesteHist] = useState([]);
  const [testeMsg, setTesteMsg] = useState("");
  const [testeDivida, setTesteDivida] = useState({ valor: "890", vencimento: "2026-06-10", codigoAluno: "AL-1234" });
  const [testando, setTestando] = useState(false);
  const testeRef = useRef(null);

  function set(campo, valor) { setC((prev) => ({ ...prev, [campo]: valor })); }

  const SECOES_SDR = [
    { k: "identidade", lb: "Identificação" }, { k: "persona", lb: "Persona" },
    { k: "objecoes", lb: "Objeções e FAQ" }, { k: "playbook", lb: "Roteiro" },
    { k: "escalacao", lb: "Escalação" }, { k: "conhecimento", lb: "Base de conhecimento" },
    { k: "teste", lb: "Testar" },
  ];
  const SECOES_NEG = [
    { k: "identidade", lb: "Identificação" }, { k: "persona", lb: "Persona" },
    { k: "negociacao", lb: "Regras de negociação" }, { k: "objecoes", lb: "Objeções e FAQ" },
    { k: "playbook", lb: "Roteiro" }, { k: "escalacao", lb: "Escalação" },
    { k: "conhecimento", lb: "Base de conhecimento" }, { k: "teste", lb: "Testar" },
  ];
  const secoes = papel === "sdr" ? SECOES_SDR : SECOES_NEG; // negociadora e completa usam as mesmas seções
  const PAPEL_LABEL = { sdr: "SDR", negociadora: "Negociadora", completa: "IA Completa" };
  const PAPEL_SUB = { sdr: "Qualifica e entende o motivo da inadimplência", negociadora: "Apresenta propostas dentro das regras que você definir", completa: "Qualifica e negocia na mesma conversa, do início ao fim" };

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
      const r = await api.previewIA({ nome, papel, config: c, conhecimento, historico: hist, divida: testeDivida });
      setTesteHist([...hist, { role: "me", content: r.resposta + (r.passarHumano ? "  [passaria pro humano]" : r.passarNegociadora ? "  [passaria pra negociadora]" : "") }]);
    } catch (e) { setTesteHist([...hist, { role: "me", content: "Erro: " + e.message }]); } finally { setTestando(false); }
  }
  useEffect(() => { if (testeRef.current) testeRef.current.scrollTop = testeRef.current.scrollHeight; }, [testeHist.length]);

  return (
    <div className="agx-overlay">
      <div className="agx-modal">
        <div className="agx-head">
          <div className="agx-head-l">
            <div className="agx-avatar">{papel === "sdr" ? "S" : papel === "completa" ? "C" : "N"}</div>
            <div>
              <div className="agx-title">{ia ? "Editar IA" : "Nova IA"} — {PAPEL_LABEL[papel]}</div>
              <div className="agx-sub">{PAPEL_SUB[papel]}</div>
            </div>
          </div>
          <div className="agx-head-r">
            {erro && <span style={{ color: "var(--coral)", fontSize: 13 }}>{erro}</span>}
            <button className="agx-btn-ghost" onClick={onClose}>Cancelar</button>
            <button className="agx-btn-primary" onClick={salvar} disabled={salvando}>{salvando ? "Salvando..." : "Salvar"}</button>
          </div>
        </div>
        <div className="agx-body">
          <aside className="agx-side">
            {secoes.map((it) => (
              <button key={it.k} className={"agx-side-item" + (secao === it.k ? " on" : "")} onClick={() => setSecao(it.k)}>
                <span className="agx-side-lb">{it.lb}</span>
              </button>
            ))}
          </aside>
          <main className="agx-main">
            {secao === "identidade" && (
              <div>
                <h4 className="agx-h">Identificação</h4>
                <div className="agx-grid2">
                  <div className="agx-field"><label>Nome da IA *</label><input className="agx-input" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: SDR Financeiro" /></div>
                  <div className="agx-field"><label>Papel</label>
                    <select className="agx-input" value={papel} onChange={(e) => setPapel(e.target.value)}>
                      <option value="sdr">SDR (qualifica, coleta motivo)</option>
                      <option value="negociadora">Negociadora (propõe pagamento)</option>
                    </select>
                  </div>
                </div>
                {papel === "sdr" && (
                  <div className="agx-field">
                    <label>Encaminha pra qual Negociadora?</label>
                    <select className="agx-input" value={proximaIaId} onChange={(e) => setProximaIaId(e.target.value)}>
                      <option value="">— nenhuma (fica só qualificando, você decide manual) —</option>
                      {iasNegociadoras.map((n) => <option key={n.id} value={n.id}>{n.nome}</option>)}
                    </select>
                  </div>
                )}
                <div className="agx-field">
                  <label>Tom de voz</label>
                  <select className="agx-input" value={c.tomVoz} onChange={(e) => set("tomVoz", e.target.value)}>
                    <option value="profissional">Profissional</option>
                    <option value="amigavel">Amigável e próximo</option>
                    <option value="consultivo">Consultivo</option>
                    <option value="direto">Direto e objetivo</option>
                  </select>
                </div>
                <div className="agx-field"><label>Objetivo principal</label><input className="agx-input" value={c.objetivo} onChange={(e) => set("objetivo", e.target.value)} /></div>
                <div className="agx-field" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={ativa} onChange={(e) => setAtiva(e.target.checked)} /> <label style={{ margin: 0 }}>IA ativa</label>
                </div>
              </div>
            )}
            {secao === "persona" && (
              <div>
                <h4 className="agx-h">Personalidade</h4>
                <div className="agx-field"><label>Quem ela é</label><textarea className="agx-input" rows={4} value={c.quemEla} onChange={(e) => set("quemEla", e.target.value)} placeholder="Ex: Você é a Bia, atendente do financeiro da Escola Instructiva..." /></div>
                <div className="agx-field"><label>Como escreve</label><textarea className="agx-input" rows={3} value={c.comoEscreve} onChange={(e) => set("comoEscreve", e.target.value)} /></div>
                <div className="agx-grid2">
                  <div className="agx-field"><label>SEMPRE faz</label><textarea className="agx-input" rows={5} value={c.sempreFaz} onChange={(e) => set("sempreFaz", e.target.value)} /></div>
                  <div className="agx-field"><label>NUNCA faz</label><textarea className="agx-input" rows={5} value={c.nuncaFaz} onChange={(e) => set("nuncaFaz", e.target.value)} /></div>
                </div>
              </div>
            )}
            {secao === "negociacao" && (
              <div>
                <h4 className="agx-h">Limite de autonomia (o "treino" da negociação)</h4>
                <div className="agx-field"><label>Formas de pagamento aceitas</label><input className="agx-input" value={c.formasPagamento} onChange={(e) => set("formasPagamento", e.target.value)} placeholder="Ex: Pix, boleto ou cartão" /></div>
                <div className="agx-grid2">
                  <div className="agx-field"><label>Parcelamento máximo sem aprovação humana</label><input className="agx-input" type="number" min="0" max="60" value={c.parcelamentoMax} onChange={(e) => set("parcelamentoMax", Number(e.target.value))} /></div>
                  <div className="agx-field"><label>Desconto máximo à vista (%) sem aprovação</label><input className="agx-input" type="number" min="0" max="100" value={c.descontoMaximoPct} onChange={(e) => set("descontoMaximoPct", Number(e.target.value))} /></div>
                </div>
                <div className="agx-field"><label>Regras extras de negociação</label><textarea className="agx-input" rows={4} value={c.regrasNegociacao} onChange={(e) => set("regrasNegociacao", e.target.value)} placeholder="Ex: nunca oferecer desconto pra quem está a menos de 30 dias de atraso" /></div>
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
                    <div className="agx-field"><label>O que o aluno diz</label><input className="agx-input" value={o.objecao || ""} onChange={(e) => set("objecoes", c.objecoes.map((x, idx) => idx === i ? { ...x, objecao: e.target.value } : x))} /></div>
                    <div className="agx-field"><label>Como a IA responde</label><textarea className="agx-input" rows={2} value={o.resposta || ""} onChange={(e) => set("objecoes", c.objecoes.map((x, idx) => idx === i ? { ...x, resposta: e.target.value } : x))} /></div>
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
                    <div className="agx-field"><label>Pergunta</label><input className="agx-input" value={q.pergunta || ""} onChange={(e) => set("faq", c.faq.map((x, idx) => idx === i ? { ...x, pergunta: e.target.value } : x))} /></div>
                    <div className="agx-field"><label>Resposta</label><textarea className="agx-input" rows={2} value={q.resposta || ""} onChange={(e) => set("faq", c.faq.map((x, idx) => idx === i ? { ...x, resposta: e.target.value } : x))} /></div>
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
                    <div className="agx-field"><label>1. Abertura</label><textarea className="agx-input" rows={2} value={c.pbAbertura} onChange={(e) => set("pbAbertura", e.target.value)} /></div>
                    <div className="agx-field"><label>2. Confirmação de identidade</label><textarea className="agx-input" rows={2} value={c.pbConfirmacao} onChange={(e) => set("pbConfirmacao", e.target.value)} /></div>
                    <div className="agx-field"><label>3. Coleta do motivo do atraso</label><textarea className="agx-input" rows={2} value={c.pbColeta} onChange={(e) => set("pbColeta", e.target.value)} /></div>
                    <div className="agx-field"><label>4. Recuperação (se sumir)</label><textarea className="agx-input" rows={2} value={c.pbRecuperacao} onChange={(e) => set("pbRecuperacao", e.target.value)} /></div>
                  </>
                ) : (
                  <>
                    <div className="agx-field"><label>1. Apresentação das opções de pagamento</label><textarea className="agx-input" rows={2} value={c.pbNegociacao} onChange={(e) => set("pbNegociacao", e.target.value)} /></div>
                    <div className="agx-field"><label>2. Fechamento</label><textarea className="agx-input" rows={2} value={c.pbFechamento} onChange={(e) => set("pbFechamento", e.target.value)} /></div>
                    <div className="agx-field"><label>3. Recuperação (se sumir)</label><textarea className="agx-input" rows={2} value={c.pbRecuperacao} onChange={(e) => set("pbRecuperacao", e.target.value)} /></div>
                  </>
                )}
              </div>
            )}
            {secao === "escalacao" && (
              <div>
                <h4 className="agx-h">Quando passar pro humano</h4>
                <div className="agx-field"><label>Critérios extras (além dos padrão: disputa, ameaça, hostilidade)</label><textarea className="agx-input" rows={3} value={c.escQuando} onChange={(e) => set("escQuando", e.target.value)} /></div>
                <div className="agx-field"><label>Frase natural de transição (o aluno não percebe a troca)</label><input className="agx-input" value={c.escFrase} onChange={(e) => set("escFrase", e.target.value)} placeholder='Ex: "Deixa eu confirmar isso com o financeiro e já te retorno"' /></div>
                <div className="agx-field"><label>Quando encerrar / parar de insistir</label><textarea className="agx-input" rows={3} value={c.encerrarCriterios} onChange={(e) => set("encerrarCriterios", e.target.value)} /></div>
              </div>
            )}
            {secao === "conhecimento" && (
              <div>
                <h4 className="agx-h">Base de conhecimento</h4>
                <p className="agx-psub">Cole informações de referência (políticas de cobrança, FAQ interno, etc).</p>
                {conhecimento.map((k) => (
                  <div className="agx-kb-item" key={k.id || k.nome}>
                    <div className="agx-kb-info"><b>{k.nome}</b></div>
                    <button className="agx-kb-x" onClick={() => setConhecimento(conhecimento.filter((x) => x !== k))}>×</button>
                  </div>
                ))}
                <div className="agx-sep" />
                <div className="agx-field"><label>Título</label><input className="agx-input" value={novoKb.nome} onChange={(e) => setNovoKb({ ...novoKb, nome: e.target.value })} /></div>
                <div className="agx-field"><label>Texto</label><textarea className="agx-input" rows={4} value={novoKb.texto} onChange={(e) => setNovoKb({ ...novoKb, texto: e.target.value })} /></div>
                <button className="agx-add" onClick={() => { if (novoKb.nome && novoKb.texto) { setConhecimento([...conhecimento, { ...novoKb }]); setNovoKb({ nome: "", texto: "" }); } }}>+ Adicionar</button>
              </div>
            )}
            {secao === "teste" && (
              <div>
                <h4 className="agx-h">Testar a IA</h4>
                <p className="agx-psub">Simula uma conversa sem mandar WhatsApp de verdade.</p>
                <div className="agx-grid2">
                  <div className="agx-field"><label>Valor da dívida (teste)</label><input className="agx-input" value={testeDivida.valor} onChange={(e) => setTesteDivida({ ...testeDivida, valor: e.target.value })} /></div>
                  <div className="agx-field"><label>Vencimento (teste)</label><input className="agx-input" type="date" value={testeDivida.vencimento} onChange={(e) => setTesteDivida({ ...testeDivida, vencimento: e.target.value })} /></div>
                </div>
                <div ref={testeRef} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12, minHeight: 200, maxHeight: 320, overflowY: "auto", marginBottom: 10, background: "var(--surface-2)" }}>
                  {testeHist.length === 0 && <div className="cob-empty">Manda uma mensagem como se fosse o aluno.</div>}
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
  const [editando, setEditando] = useState(null);
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
      <div className="page-head">
        <div><h2>IAs</h2><p>SDR qualifica, Negociadora propõe pagamento.</p></div>
      </div>
      <div className="cob-card">
        <div className="cob-card-h">
          <h3>Botão de pânico</h3>
          <button className={"btn btn-sm " + (globalAtiva ? "btn-danger" : "btn-primary")} onClick={toggleGlobal}>
            {globalAtiva ? "Desligar todas as IAs agora" : "Religar as IAs"}
          </button>
        </div>
        <div className="cob-card-body" style={{ paddingTop: 0 }}>
          <p className="agx-psub" style={{ margin: 0 }}>{globalAtiva ? "As IAs estão respondendo normalmente." : "Todas as IAs estão pausadas — nenhuma responde até você religar."}</p>
        </div>
      </div>

      <div className="cob-card">
        <div className="cob-card-h">
          <h3>Suas IAs</h3>
          <div style={{ display: "flex", gap: 8 }}>
            <select className="select" value={criandoPapel} onChange={(e) => setCriandoPapel(e.target.value)}>
              <option value="sdr">Nova SDR</option>
              <option value="negociadora">Nova Negociadora</option>
            </select>
            <button className="btn btn-primary btn-sm" onClick={() => setEditando({ novo: true, papel: criandoPapel })}><I.plus style={{ width: 14, height: 14 }} /> Criar</button>
          </div>
        </div>
        {lista.map((ia) => (
          <div className="cob-row" key={ia.id}>
            <div className="info">
              <div className="nm">{ia.nome} {!ia.ativa && <span className="cob-pill off" style={{ marginLeft: 6 }}>pausada</span>}</div>
              <div className="sub">{ia.papel === "negociadora" ? "Negociadora" : "SDR"}{ia.papel === "sdr" && ia.proximaIaId ? " → encaminha pra " + (lista.find((x) => x.id === ia.proximaIaId)?.nome || "?") : ""}</div>
            </div>
            <button className="btn btn-sm btn-ghost" onClick={() => setEditando(ia)}>Editar</button>
            <button className="btn btn-sm btn-danger" onClick={() => excluir(ia.id)}><I.trash style={{ width: 14, height: 14 }} /></button>
          </div>
        ))}
        {lista.length === 0 && <div className="cob-empty">Nenhuma IA criada ainda. Comece pela SDR.</div>}
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
   DISPARO EM MASSA — CSV ou adição manual
   ============================================================ */
function CampanhaDrawer({ campanhaId, onClose, onDeleted }) {
  const [c, setC] = useState(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    let cancelado = false;
    function carregar() { api.campanha(campanhaId).then((r) => { if (!cancelado) setC(r); }).catch((e) => setErro(e.message)); }
    carregar();
    const t = setInterval(carregar, 4000);
    return () => { cancelado = true; clearInterval(t); };
  }, [campanhaId]);

  async function excluir() {
    if (!confirm("Excluir essa campanha? Isso também apaga as conversas que nasceram dela (mensagens somem).")) return;
    await api.excluirCampanha(campanhaId);
    onDeleted();
  }

  const STATUS_LABEL = { enviado: "Enviado", entregue: "Entregue", lido: "Lido", falhou_entrega: "Falhou na entrega", falha: "Falha ao enviar" };
  const STATUS_COR = { enviado: "em_conversa", entregue: "negociando", lido: "pago", falhou_entrega: "perdido", falha: "perdido" };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="drawer">
        <div className="drawer-h">
          <h3>{c ? c.nome : "Carregando..."}</h3>
          <div style={{ display: "flex", gap: 6 }}>
            {c && <button className="btn btn-sm btn-ghost" style={{ color: "var(--coral)" }} onClick={excluir}><I.trash style={{ width: 14, height: 14 }} /></button>}
            <button className="x-btn" onClick={onClose}><I.x /></button>
          </div>
        </div>
        <div className="drawer-body">
          {erro && <div className="err">{erro}</div>}
          {!c ? <div className="spin" /> : (
            <>
              <div className="dash-grid" style={{ gridTemplateColumns: "repeat(2, 1fr)", marginBottom: 16 }}>
                <div className="dash-card" style={{ padding: 12 }}><div className="lab">Enviados</div><div className="val" style={{ fontSize: 20 }}>{c.enviados}/{c.total}</div></div>
                <div className="dash-card good" style={{ padding: 12 }}><div className="lab">Responderam</div><div className="val" style={{ fontSize: 20 }}>{c.responderam}</div></div>
                <div className="dash-card" style={{ padding: 12 }}><div className="lab">Entregues</div><div className="val" style={{ fontSize: 20 }}>{c.entregues}</div></div>
                <div className="dash-card warn" style={{ padding: 12 }}><div className="lab">Falhas</div><div className="val" style={{ fontSize: 20 }}>{c.falhas}</div></div>
              </div>
              <p className="agx-psub">Número: <strong>{c.numeroApelido}</strong> · Template: <strong>{c.template}</strong> · Status: {c.status}{c.pendentesCount > 0 ? ` (${c.pendentesCount} na fila)` : ""}</p>
              <div className="agx-sep" />
              <h4 className="agx-h">Por contato</h4>
              {(!c.envios || c.envios.length === 0) && <div className="cob-empty">Nenhum envio registrado ainda.</div>}
              {(c.envios || []).slice().reverse().map((e, i) => (
                <div className="cob-row" key={i} style={{ padding: "10px 0" }}>
                  <div className="info">
                    <div className="nm">{e.nome || e.telefone}</div>
                    <div className="sub">{e.telefone}{e.erro ? " — " + e.erro : ""}</div>
                  </div>
                  <span className={"estado-badge " + (STATUS_COR[e.statusEntrega || e.status] || "nao_contatado")}>{STATUS_LABEL[e.statusEntrega || e.status] || e.status}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
}

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
  const [modo, setModo] = useState("csv");
  const [manual, setManual] = useState({ nome: "", telefone: "", valor: "", vencimento: "", codigoAluno: "" });
  const [campanhaAberta, setCampanhaAberta] = useState(null);
  const fileRef = useRef(null);

  const templateInfo = templates.find((t) => t.name === template) || null;
  const nVars = templateInfo ? templateInfo.vars : 0;

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

  // sempre que trocar de template, limpa a lista (as variáveis mudam o formato dos contatos)
  useEffect(() => { setContatos([]); }, [template]);

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
        const idxCpf = header.findIndex((h) => h.includes("cpf"));
        const idxEmail = header.findIndex((h) => h.includes("email") || h.includes("e-mail"));
        if (idxTel < 0) { setErro("Não achei a coluna de telefone no CSV. Cabeçalho encontrado: " + header.join(", ")); return; }
        // colunas de variável: "variavel1", "var1", "variavel2"... se não achar, usa o nome como {{1}}
        const idxVars = [];
        for (let n = 1; n <= Math.max(nVars, 1); n++) {
          idxVars.push(header.findIndex((h) => h === "variavel" + n || h === "var" + n));
        }
        const out = linhas.map((l) => {
          const nome = idxNome >= 0 ? l[idxNome] : "";
          const variaveis = [];
          for (let n = 0; n < nVars; n++) {
            const idx = idxVars[n];
            variaveis.push(idx >= 0 && l[idx] ? l[idx] : (n === 0 ? nome : ""));
          }
          return {
            nome, telefone: l[idxTel], variaveis,
            divida: {
              valor: idxValor >= 0 ? l[idxValor].replace(",", ".") : "",
              vencimento: idxVenc >= 0 ? l[idxVenc] : "",
              codigoAluno: idxCod >= 0 ? l[idxCod] : "",
              cpf: idxCpf >= 0 ? l[idxCpf] : "",
              email: idxEmail >= 0 ? l[idxEmail] : "",
            },
          };
        }).filter((c) => c.telefone);
        setContatos(out);
        setErro("");
      } catch (e) { setErro("Erro ao ler o CSV: " + e.message); }
    };
    reader.readAsText(f, "utf-8");
  }

  function adicionarManual() {
    if (!manual.telefone.trim()) { setErro("Informe o telefone"); return; }
    const variaveis = [];
    for (let n = 0; n < nVars; n++) variaveis.push(manual["var" + n] || (n === 0 ? manual.nome : ""));
    setContatos([...contatos, { nome: manual.nome, telefone: manual.telefone, variaveis, divida: { valor: manual.valor, vencimento: manual.vencimento, codigoAluno: manual.codigoAluno } }]);
    setManual({ nome: "", telefone: "", valor: "", vencimento: "", codigoAluno: "" });
    setErro("");
  }
  function removerContato(i) { setContatos(contatos.filter((_, idx) => idx !== i)); }

  async function disparar() {
    setErro("");
    if (!numeroId) return setErro("Escolha um número");
    if (!template) return setErro("Escolha um template aprovado");
    if (!contatos.length) return setErro("Adicione ao menos um contato");
    if (!iaId) {
      const ok = confirm('Nenhuma IA selecionada. Quem responder vai direto pro atendente humano — a IA NÃO vai responder sozinha nessa campanha. Confirma que é isso mesmo?');
      if (!ok) return;
    }
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
      <div className="page-head">
        <div><h2>Disparo em massa</h2><p>Monta a campanha e manda pra base de inadimplentes.</p></div>
      </div>

      <div className="cob-card">
        <div className="cob-card-body">
          <div className="row2">
            <div className="field"><label>Número</label>
              <select className="select" value={numeroId} onChange={(e) => { setNumeroId(e.target.value); setTemplate(""); const n = numeros.find((x) => x.id === e.target.value); if (n && n.iaDefaultId && !iaId) setIaId(n.iaDefaultId); }}>
                <option value="">Selecione</option>
                {numeros.map((n) => <option key={n.id} value={n.id}>{n.apelido}</option>)}
              </select>
            </div>
            <div className="field"><label>Template aprovado (Meta)</label>
              <select className="select" value={template} onChange={(e) => setTemplate(e.target.value)} disabled={!numeroId}>
                <option value="">{numeroId ? "Selecione" : "Escolha um número primeiro"}</option>
                {templates.map((t) => <option key={t.name} value={t.name}>{t.name}{t.vars ? ` (${t.vars} variável${t.vars > 1 ? "eis" : ""})` : ""}</option>)}
              </select>
            </div>
          </div>
          {templateInfo && (
            <div style={{ background: "var(--surface-2)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
              <strong style={{ color: "var(--text)" }}>Prévia:</strong> {templateInfo.texto}
              {nVars > 0 && <div style={{ marginTop: 4 }}>{nVars} variável(is) — no CSV use colunas <code>variavel1</code>, <code>variavel2</code>... (senão, {"{{1}}"} usa o nome automaticamente).</div>}
            </div>
          )}
          {templates.length === 0 && numeroId && <p className="agx-psub" style={{ marginTop: 8, marginBottom: 0 }}>Nenhum template aprovado ainda pra esse número. Cria um em Meta for Developers → WhatsApp → Message Templates.</p>}

          <div className="agx-sep" />

          <div className="row2">
            <div className="field"><label>IA que assume quando o aluno responder</label>
              <select className="select" value={iaId} onChange={(e) => setIaId(e.target.value)}>
                <option value="">Nenhuma (vai direto pro atendente humano)</option>
                {ias.map((i) => <option key={i.id} value={i.id}>{i.nome} ({i.papel})</option>)}
              </select>
            </div>
            <div className="field"><label>Nome da campanha</label><input className="input" value={nomeCampanha} onChange={(e) => setNomeCampanha(e.target.value)} placeholder="Ex: Cobrança julho/2026" /></div>
          </div>

          <div className="agx-sep" />

          <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", display: "block", marginBottom: 10 }}>Quem vai receber</label>
          <div className="tabs">
            <button className={modo === "csv" ? "on" : ""} onClick={() => setModo("csv")}>Importar CSV</button>
            <button className={modo === "manual" ? "on" : ""} onClick={() => setModo("manual")}>Adicionar manualmente</button>
          </div>

          {modo === "csv" ? (
            <label className="upload-box" htmlFor="csv-input">
              <input id="csv-input" ref={fileRef} type="file" accept=".csv,text/csv" onChange={onArquivo} />
              <I.upload className="ic" />
              <div className="t">{arquivoNome || "Clique para escolher o arquivo CSV"}</div>
              <div className="s">colunas: nome, telefone, valor, vencimento, código do aluno{nVars > 0 ? ", variavel1..." + nVars : ""}</div>
              <div className="s">opcionais: cpf, email</div>
            </label>
          ) : (
            <div>
              <div className="row2">
                <div className="field"><label>Nome</label><input className="input" value={manual.nome} onChange={(e) => setManual({ ...manual, nome: e.target.value })} /></div>
                <div className="field"><label>Telefone</label><input className="input" value={manual.telefone} onChange={(e) => setManual({ ...manual, telefone: e.target.value })} placeholder="44999998888 (com DDD, sem espaço)" /></div>
              </div>
              <div className="row2">
                <div className="field"><label>Valor</label><input className="input" value={manual.valor} onChange={(e) => setManual({ ...manual, valor: e.target.value })} placeholder="350.00" /></div>
                <div className="field"><label>Vencimento</label><input className="input" type="date" value={manual.vencimento} onChange={(e) => setManual({ ...manual, vencimento: e.target.value })} /></div>
              </div>
              <div className="field"><label>Código do aluno</label><input className="input" value={manual.codigoAluno} onChange={(e) => setManual({ ...manual, codigoAluno: e.target.value })} /></div>
              {nVars > 0 && Array.from({ length: nVars }).map((_, n) => (
                <div className="field" key={n}><label>Variável {"{{" + (n + 1) + "}}"}{n === 0 ? " (padrão: nome)" : ""}</label>
                  <input className="input" value={manual["var" + n] || ""} onChange={(e) => setManual({ ...manual, ["var" + n]: e.target.value })} placeholder={n === 0 ? manual.nome || "usa o nome se deixar em branco" : ""} />
                </div>
              ))}
              <button className="btn btn-primary btn-sm" onClick={adicionarManual}><I.plus style={{ width: 14, height: 14 }} /> Adicionar à lista</button>
            </div>
          )}

          {contatos.length > 0 && (
            <div className="contatos-preview">
              <table>
                <thead><tr><th>Nome</th><th>Telefone</th><th>Valor</th><th>Vencimento</th><th>CPF</th><th>E-mail</th>{nVars > 0 && <th>Variáveis</th>}<th></th></tr></thead>
                <tbody>
                  {contatos.map((c, i) => (
                    <tr key={i}>
                      <td>{c.nome || "—"}</td><td>{c.telefone}</td>
                      <td>{c.divida?.valor ? fmtMoeda(c.divida.valor) : "—"}</td>
                      <td>{c.divida?.vencimento || "—"}</td>
                      <td>{c.divida?.cpf || "—"}</td>
                      <td>{c.divida?.email || "—"}</td>
                      {nVars > 0 && <td>{(c.variaveis || []).join(" · ") || "—"}</td>}
                      <td><button className="btn btn-sm btn-ghost" onClick={() => removerContato(i)}><I.x style={{ width: 12, height: 12 }} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {erro && <div className="err">{erro}</div>}
          <p style={{ fontSize: 12.5, margin: "0 0 8px", color: iaId ? "var(--mint)" : "var(--amber)", fontWeight: 600 }}>
            {iaId ? `✓ IA vinculada: ${ias.find((i) => i.id === iaId)?.nome || "..."} — vai responder sozinha quem responder` : "⚠ Sem IA selecionada — quem responder vai direto pro atendente humano"}
          </p>
          <div style={{ display: "flex", gap: 10 }}>
            {contatos.length > 0 && (
              <button className="btn btn-ghost" disabled={enviando} onClick={() => { setContatos([]); setArquivoNome(""); if (fileRef.current) fileRef.current.value = ""; }} style={{ flex: "0 0 auto", padding: "13px 20px" }}>
                Cancelar
              </button>
            )}
            <button className="btn btn-primary" disabled={enviando || !contatos.length} onClick={disparar} style={{ flex: 1, fontSize: 15, padding: "13px" }}>
              {enviando ? "Disparando..." : `Disparar pra ${contatos.length} contato(s)`}
            </button>
          </div>
        </div>
      </div>

      <div className="cob-card">
        <div className="cob-card-h"><h3>Campanhas</h3></div>
        {campanhas.map((c) => (
          <div className="cob-row" key={c.id} style={{ cursor: "pointer" }} onClick={() => setCampanhaAberta(c.id)}>
            <div className="info"><div className="nm">{c.nome}</div><div className="sub">{c.enviados}/{c.total} enviados · {c.responderam} responderam · {c.falhas} falhas · {c.status}</div></div>
            {c.status === "rodando" && <button className="btn btn-sm btn-ghost" style={{ color: "var(--coral)" }} onClick={(e) => { e.stopPropagation(); if (confirm("Cancelar esse disparo? Quem ainda não recebeu, não vai receber.")) api.cancelarCampanha(c.id).then(carregar); }}>Cancelar</button>}
            {c.status !== "rodando" && c.pendentesCount > 0 && <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); api.retomarCampanha(c.id).then(carregar); }}>Retomar</button>}
            <button className="btn btn-sm btn-ghost" style={{ color: "var(--coral)" }} onClick={(e) => { e.stopPropagation(); if (confirm("Excluir essa campanha? Isso também apaga as conversas que nasceram dela (mensagens somem).")) api.excluirCampanha(c.id).then(carregar); }}><I.trash style={{ width: 14, height: 14 }} /></button>
          </div>
        ))}
        {campanhas.length === 0 && <div className="cob-empty">Nenhuma campanha disparada ainda.</div>}
      </div>

      {campanhaAberta && <CampanhaDrawer campanhaId={campanhaAberta} onClose={() => setCampanhaAberta(null)} onDeleted={() => { setCampanhaAberta(null); carregar(); }} />}
    </div>
  );
}

/* ============================================================
   ACORDOS — automação pós-acordo (parcelas, lembretes, quebra)
   ============================================================ */
function ConfigLembretes() {
  const [cfg, setCfg] = useState(null);
  const [numeros, setNumeros] = useState([]);
  const [numeroId, setNumeroId] = useState("");
  const [templates, setTemplates] = useState([]);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api.config().then(setCfg).catch(() => {});
    api.numeros().then(setNumeros).catch(() => {});
  }, []);
  useEffect(() => {
    if (!numeroId) { setTemplates([]); return; }
    api.templates(numeroId).then((r) => setTemplates(r.templates || [])).catch(() => setTemplates([]));
  }, [numeroId]);

  async function salvar() {
    setSalvando(true); setMsg("");
    try { const r = await api.setConfig(cfg); setCfg(r); setMsg("Salvo."); } catch (e) { setMsg("Erro: " + e.message); } finally { setSalvando(false); }
  }

  if (!cfg) return null;
  return (
    <div className="cob-card">
      <div className="cob-card-h"><h3>Lembretes automáticos <span className="soon-badge">configura aqui</span></h3></div>
      <div className="cob-card-body">
        <p className="agx-psub">
          A cada hora, o sistema confere as parcelas de todo acordo. Manda o template de lembrete alguns dias antes do
          vencimento, e se a parcela vencer sem pagamento (+ carência), marca o acordo como quebrado e reabre pro atendente,
          usando o template de quebra (se configurado).
        </p>
        <div className="field"><label>Número (só pra listar os templates aprovados dele)</label>
          <select className="select" value={numeroId} onChange={(e) => setNumeroId(e.target.value)}>
            <option value="">Selecione</option>
            {numeros.map((n) => <option key={n.id} value={n.id}>{n.apelido}</option>)}
          </select>
        </div>
        <div className="row2">
          <div className="field"><label>Template de lembrete</label>
            <select className="select" value={cfg.templateLembrete} onChange={(e) => setCfg({ ...cfg, templateLembrete: e.target.value })}>
              <option value="">Nenhum (não manda lembrete)</option>
              {templates.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select>
          </div>
          <div className="field"><label>Template de aviso de quebra</label>
            <select className="select" value={cfg.templateQuebra} onChange={(e) => setCfg({ ...cfg, templateQuebra: e.target.value })}>
              <option value="">Nenhum (não avisa)</option>
              {templates.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select>
          </div>
        </div>
        <div className="row2">
          <div className="field"><label>Dias antes do vencimento pra lembrar</label><input className="input" type="number" min="0" max="10" value={cfg.diasAntesLembrete} onChange={(e) => setCfg({ ...cfg, diasAntesLembrete: Number(e.target.value) })} /></div>
          <div className="field"><label>Dias de carência antes de considerar quebrado</label><input className="input" type="number" min="0" max="15" value={cfg.diasCarencia} onChange={(e) => setCfg({ ...cfg, diasCarencia: Number(e.target.value) })} /></div>
        </div>
        <div className="agx-sep" />
        <h4 className="agx-h" style={{ marginBottom: 6 }}>Vigilância de vencimento original (antes de qualquer acordo)</h4>
        <p className="agx-psub">
          Cobre quem foi disparado mas nunca fechou acordo — se o vencimento original passar dessa quantidade de dias sem
          resolução, o sistema escala automaticamente pra um atendente humano revisar (não manda mensagem sozinho aqui,
          só evita que o caso fique esquecido).
        </p>
        <div className="field"><label>Dias após o vencimento original pra escalar</label><input className="input" type="number" min="0" max="30" value={cfg.diasCarenciaContatoInicial} onChange={(e) => setCfg({ ...cfg, diasCarenciaContatoInicial: Number(e.target.value) })} /></div>
        {msg && <p className="agx-psub" style={{ color: msg.startsWith("Erro") ? "var(--coral)" : "var(--mint)" }}>{msg}</p>}
        <button className="btn btn-primary" onClick={salvar} disabled={salvando}>{salvando ? "Salvando..." : "Salvar"}</button>
      </div>
    </div>
  );
}

function AcordosScreen() {
  const [lista, setLista] = useState([]);
  async function carregar() { try { setLista(await api.acordos()); } catch (_) {} }
  useEffect(() => { carregar(); const t = setInterval(carregar, 15000); return () => clearInterval(t); }, []);

  async function pagar(acordoId, numero) { await api.pagarParcela(acordoId, numero); carregar(); }

  return (
    <div className="content">
      <div className="page-head">
        <div><h2>Acordos</h2><p>Parcelas, lembretes e quebra de acordo automáticos.</p></div>
      </div>
      <ConfigLembretes />
      <div className="cob-card">
        <div className="cob-card-h"><h3>Acordos fechados</h3></div>
        {lista.map((a) => (
          <div key={a.id} style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, alignItems: "center" }}>
              <div><strong style={{ color: "var(--text)" }}>{a.nomeAluno}</strong> <span style={{ color: "var(--muted)", fontSize: 12.5 }}>{a.numero}</span></div>
              {a.quebrado && <span className="estado-badge perdido">acordo quebrado</span>}
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {a.parcelas.map((p) => (
                <div key={p.numero} style={{ minWidth: 150, background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 600 }}>Parcela {p.numero}</div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: "var(--text)", margin: "3px 0" }}>{fmtMoeda(p.valor)}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>venc. {p.vencimento}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>status: {p.status}</div>
                  {p.status !== "pago" && <button className="btn btn-sm btn-primary" style={{ width: "100%" }} onClick={() => pagar(a.id, p.numero)}>Marcar como pago</button>}
                </div>
              ))}
            </div>
          </div>
        ))}
        {lista.length === 0 && <div className="cob-empty">Nenhum acordo registrado ainda.</div>}
      </div>
    </div>
  );
}

/* ============================================================
   LIGAÇÕES — Twilio + ElevenLabs (config inicial; motor de discagem
   e IA de voz entram na próxima etapa)
   ============================================================ */
function TemplatesScreen() {
  const [numeros, setNumeros] = useState([]);
  const [numeroId, setNumeroId] = useState("");
  const [todos, setTodos] = useState([]);
  const [modalAberto, setModalAberto] = useState(false);
  const [form, setForm] = useState({ numeroId: "", nome: "", corpo: "", categoria: "UTILITY", idioma: "pt_BR" });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [msgOk, setMsgOk] = useState("");

  useEffect(() => {
    api.numeros().then((r) => {
      setNumeros(r);
      if (r.length === 1) { setNumeroId(r[0].id); setForm((f) => ({ ...f, numeroId: r[0].id })); } // só 1 número? já seleciona
    }).catch(() => {});
  }, []);

  async function carregarTemplates(id) {
    const alvo = id || numeroId;
    if (!alvo) { setTodos([]); return; }
    try { const r = await api.templates(alvo); setTodos(r.todos || r.templates || []); } catch (_) { setTodos([]); }
  }
  useEffect(() => { carregarTemplates(); }, [numeroId]);

  const STATUS_COR = { APPROVED: "pago", PENDING: "negociando", REJECTED: "perdido" };
  const STATUS_LABEL = { APPROVED: "Aprovado", PENDING: "Em análise", REJECTED: "Rejeitado" };

  function contarVars(texto) { return (texto.match(/\{\{\d+\}\}/g) || []).length; }

  function abrirModal() {
    setForm({ numeroId: numeroId || (numeros[0] && numeros[0].id) || "", nome: "", corpo: "", categoria: "UTILITY", idioma: "pt_BR" });
    setErro(""); setMsgOk("");
    setModalAberto(true);
  }

  async function criar(e) {
    e.preventDefault();
    setErro(""); setMsgOk("");
    if (!form.numeroId) { setErro("Escolha pra qual número é esse template"); return; }
    if (!form.nome.trim()) { setErro("Dê um nome pro template"); return; }
    if (!form.corpo.trim()) { setErro("Escreve o texto da mensagem"); return; }
    setSalvando(true);
    try {
      const r = await api.criarTemplate(form.numeroId, form);
      setMsgOk(`Enviado pra análise da Meta (status: ${r.status || "PENDING"}). Aprovação costuma levar de minutos a algumas horas.`);
      setForm({ ...form, nome: "", corpo: "" });
      setNumeroId(form.numeroId);
      setTimeout(() => carregarTemplates(form.numeroId), 1500);
    } catch (e) { setErro(e.message); } finally { setSalvando(false); }
  }

  return (
    <div className="content">
      <div className="page-head">
        <div><h2>Templates</h2><p>Modelos de mensagem aprovados pela Meta pra iniciar conversa.</p></div>
        <button className="btn btn-primary" onClick={abrirModal}><I.plus style={{ width: 15, height: 15 }} /> Criar template</button>
      </div>

      <div className="cob-card">
        <div className="cob-card-body">
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Número</label>
            <select className="select" value={numeroId} onChange={(e) => setNumeroId(e.target.value)}>
              <option value="">Selecione um número pra ver os templates dele</option>
              {numeros.map((n) => <option key={n.id} value={n.id}>{n.apelido}</option>)}
            </select>
          </div>
        </div>
      </div>

      {numeroId && (
        <div className="cob-card">
          <div className="cob-card-h"><h3>Templates desse número</h3></div>
          {todos.map((t) => (
            <div className="cob-row" key={t.name}>
              <div className="info">
                <div className="nm">{t.name} {t.vars > 0 && <span className="cob-pill off" style={{ marginLeft: 6 }}>{t.vars} variável(is)</span>}</div>
                <div className="sub">{t.texto}</div>
              </div>
              <span className={"estado-badge " + (STATUS_COR[t.status] || "nao_contatado")}>{STATUS_LABEL[t.status] || t.status}</span>
            </div>
          ))}
          {todos.length === 0 && <div className="cob-empty">Nenhum template ainda pra esse número — clica em "Criar template".</div>}
        </div>
      )}

      {modalAberto && (
        <Modal titulo="Criar template" subtitulo="Vai direto pra análise da Meta — não fica disponível na hora." onClose={() => setModalAberto(false)} largura={560}>
          <form onSubmit={criar}>
            <div className="field"><label>Número (WABA que vai submeter)</label>
              <select className="select" value={form.numeroId} onChange={(e) => setForm({ ...form, numeroId: e.target.value })} autoFocus>
                <option value="">Selecione</option>
                {numeros.map((n) => <option key={n.id} value={n.id}>{n.apelido}</option>)}
              </select>
            </div>
            <div className="field"><label>Nome (só letras minúsculas e _, sem espaço)</label><input className="input" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="cobranca_chamada_simples" /></div>
            <div className="row2">
              <div className="field"><label>Categoria</label>
                <select className="select" value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })}>
                  <option value="UTILITY">Utilitário (recomendado pra cobrança)</option>
                  <option value="MARKETING">Marketing</option>
                  <option value="AUTHENTICATION">Autenticação</option>
                </select>
              </div>
              <div className="field"><label>Idioma</label>
                <select className="select" value={form.idioma} onChange={(e) => setForm({ ...form, idioma: e.target.value })}>
                  <option value="pt_BR">Português (Brasil)</option>
                  <option value="en_US">Inglês (EUA)</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label>Texto da mensagem</label>
              <textarea className="input" rows={5} value={form.corpo} onChange={(e) => setForm({ ...form, corpo: e.target.value })} placeholder="Olá! Aqui é da Escola Instructiva. Identificamos uma pendência em seu nome e gostaríamos de conversar sobre isso. Pode nos responder por aqui?" />
              <p className="agx-psub" style={{ marginTop: 6, marginBottom: 0 }}>Use {"{{1}}"}, {"{{2}}"}... só se quiser variáveis (opcional). Esse aqui tem {contarVars(form.corpo)} variável(is).</p>
            </div>
            {erro && <div className="err">{erro}</div>}
            {msgOk && <p className="agx-psub" style={{ color: "var(--mint)" }}>{msgOk}</p>}
            <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
              <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setModalAberto(false)}>Fechar</button>
              <button className="btn btn-primary" style={{ flex: 1 }} disabled={salvando}>{salvando ? "Enviando..." : "Enviar pra aprovação"}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function LigacoesScreen() {
  const [v, setV] = useState(null);
  const [form, setForm] = useState({ twilioAccountSid: "", twilioAuthToken: "", twilioNumero: "", elevenApiKey: "", elevenAgentId: "", elevenPhoneNumberId: "", companyName: "", agentName: "", descontoMaxPct: 0, origemDebitoPadrao: "" });
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState("");

  async function carregar() {
    try {
      const r = await api.vozConfig();
      setV(r);
      setForm((f) => ({ ...f, twilioAccountSid: r.twilioAccountSid, twilioNumero: r.twilioNumero, elevenAgentId: r.elevenAgentId, elevenPhoneNumberId: r.elevenPhoneNumberId, companyName: r.companyName, agentName: r.agentName, descontoMaxPct: r.descontoMaxPct, origemDebitoPadrao: r.origemDebitoPadrao }));
    } catch (_) {}
  }
  useEffect(() => { carregar(); }, []);

  async function salvar(e) {
    e.preventDefault();
    setSalvando(true); setMsg("");
    try {
      await api.setVozConfig(form);
      setMsg("Salvo.");
      carregar();
    } catch (e) { setMsg("Erro: " + e.message); } finally { setSalvando(false); }
  }

  const urlWebhookEl = typeof window !== "undefined" && v ? `${window.location.origin}/api/cobranca/webhook-elevenlabs/${v.webhookToken}` : "";

  return (
    <div className="content">
      <div className="page-head">
        <div><h2>Ligações</h2><p>IA de voz via ElevenLabs, usando seu número Twilio — pra quando o WhatsApp não é suficiente.</p></div>
      </div>

      <div className="cob-card">
        <div className="cob-card-h"><h3>Como funciona</h3></div>
        <div className="cob-card-body">
          <p className="agx-psub" style={{ margin: 0 }}>
            A ElevenLabs cuida de toda a parte de telefonia/áudio em tempo real — a gente só manda o pedido pra discar
            (com o nome, valor e vencimento do aluno) e recebe de volta o resumo da ligação, que aparece na mesma
            conversa do WhatsApp. Não precisa construir nenhuma infraestrutura de telefonia própria.
          </p>
        </div>
      </div>

      <div className="cob-card">
        <div className="cob-card-h"><h3>Passo 1 — Importar seu número Twilio na ElevenLabs</h3></div>
        <div className="cob-card-body">
          <p className="agx-psub">
            No painel da ElevenLabs (elevenlabs.io → Agents → Phone Numbers), importa seu número Twilio informando o
            Account SID e o Auth Token dele. Depois de importado, cria (ou usa) um Agente de voz e vincula esse número
            a ele. A ElevenLabs te dá um <strong>Phone Number ID</strong> — é esse valor que vai no campo abaixo.
          </p>
        </div>
      </div>

      <div className="cob-card">
        <div className="cob-card-h"><h3>Passo 2 — Credenciais</h3></div>
        <div className="cob-card-body">
          <form onSubmit={salvar}>
            <h4 className="agx-h" style={{ marginBottom: 12 }}>ElevenLabs (obrigatório pra ligar)</h4>
            <div className="field"><label>API Key {v && v.temElevenKey && <span className="cob-pill on" style={{ marginLeft: 6 }}>já salva</span>}</label><input className="input" type="password" value={form.elevenApiKey} onChange={(e) => setForm({ ...form, elevenApiKey: e.target.value })} placeholder={v && v.temElevenKey ? "•••••••• (deixe em branco pra manter)" : ""} /></div>
            <div className="row2">
              <div className="field"><label>Agent ID</label><input className="input" value={form.elevenAgentId} onChange={(e) => setForm({ ...form, elevenAgentId: e.target.value })} placeholder="agent_01..." /></div>
              <div className="field"><label>Phone Number ID</label><input className="input" value={form.elevenPhoneNumberId} onChange={(e) => setForm({ ...form, elevenPhoneNumberId: e.target.value })} placeholder="do passo 1" /></div>
            </div>

            <div className="agx-sep" />
            <h4 className="agx-h" style={{ marginBottom: 6 }}>Variáveis que o agente usa</h4>
            <p className="agx-psub">Precisa bater com o que o prompt do seu agente espera (`{"{{company_name}}"}`, `{"{{agent_name}}"}` etc).</p>
            <div className="row2">
              <div className="field"><label>Nome da empresa ({"{{company_name}}"})</label><input className="input" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} placeholder="Escola Instructiva" /></div>
              <div className="field"><label>Nome do agente ({"{{agent_name}}"})</label><input className="input" value={form.agentName} onChange={(e) => setForm({ ...form, agentName: e.target.value })} placeholder="Ana" /></div>
            </div>
            <div className="row2">
              <div className="field"><label>Desconto máximo à vista % ({"{{desconto_pct}}"})</label><input className="input" type="number" min="0" max="100" value={form.descontoMaxPct} onChange={(e) => setForm({ ...form, descontoMaxPct: Number(e.target.value) })} /></div>
              <div className="field"><label>Origem do débito padrão ({"{{origem_debito}}"})</label><input className="input" value={form.origemDebitoPadrao} onChange={(e) => setForm({ ...form, origemDebitoPadrao: e.target.value })} placeholder="Mensalidade em atraso" /></div>
            </div>

            <div className="agx-sep" />
            <h4 className="agx-h" style={{ marginBottom: 12 }}>Twilio (só referência — quem usa é a ElevenLabs)</h4>
            <div className="row2">
              <div className="field"><label>Account SID</label><input className="input" value={form.twilioAccountSid} onChange={(e) => setForm({ ...form, twilioAccountSid: e.target.value })} placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" /></div>
              <div className="field"><label>Número Twilio</label><input className="input" value={form.twilioNumero} onChange={(e) => setForm({ ...form, twilioNumero: e.target.value })} placeholder="+55 44 9xxxx-xxxx" /></div>
            </div>
            <div className="field"><label>Auth Token {v && v.temTwilioToken && <span className="cob-pill on" style={{ marginLeft: 6 }}>já salvo</span>}</label><input className="input" type="password" value={form.twilioAuthToken} onChange={(e) => setForm({ ...form, twilioAuthToken: e.target.value })} placeholder={v && v.temTwilioToken ? "•••••••• (deixe em branco pra manter)" : ""} /></div>

            {msg && <div className="agx-psub" style={{ color: msg.startsWith("Erro") ? "var(--coral)" : "var(--mint)" }}>{msg}</div>}
            <button className="btn btn-primary" disabled={salvando}>{salvando ? "Salvando..." : "Salvar"}</button>
          </form>
        </div>
      </div>

      <div className="cob-card">
        <div className="cob-card-h"><h3>Passo 3 — Webhook de pós-ligação (opcional, mas recomendado)</h3></div>
        <div className="cob-card-body">
          <p className="agx-psub">
            Configura essa URL no painel da ElevenLabs em <strong>Settings → Webhooks → Post-call</strong>, pra que o
            resumo de cada ligação apareça automaticamente na conversa do WhatsApp do aluno.
          </p>
          <div className="field"><label>URL do webhook</label><input className="input" readOnly value={urlWebhookEl} onClick={(e) => e.target.select()} /></div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   SHELL
   ============================================================ */
const NAV = [
  { k: "painel", lb: "Painel", ico: I.dash },
  { k: "conversas", lb: "Conversas", ico: I.chat },
  { k: "ias", lb: "IAs (SDR / Negociadora)", ico: I.spark },
  { k: "disparo", lb: "Disparo em massa", ico: I.send },
  { k: "templates", lb: "Templates", ico: I.doc },
  { k: "acordos", lb: "Acordos (pós-acordo)", ico: I.cash },
  { k: "ligacoes", lb: "Ligações (voz)", ico: I.phone },
  { k: "numeros", lb: "Números", ico: I.pipe },
  { k: "equipe", lb: "Equipe", ico: I.team },
];

export default function App() {
  const [user, setUser] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [secao, setSecao] = useState("painel");
  const [theme, setTheme] = useState(() => (typeof document !== "undefined" && document.documentElement.getAttribute("data-theme")) || "light");

  useEffect(() => {
    if (!getToken()) { setCarregando(false); return; }
    api.me().then(setUser).catch(() => setToken("")).finally(() => setCarregando(false));
  }, []);

  function toggleTheme() {
    setTheme((t) => {
      const n = t === "dark" ? "light" : "dark";
      if (typeof document !== "undefined") document.documentElement.setAttribute("data-theme", n);
      try { localStorage.setItem("instructiva_cobranca_theme", n); } catch (_) {}
      return n;
    });
  }
  function sair() { setToken(""); setUser(null); }

  if (carregando) return <div className="spin" />;
  if (!user) return <Login onLogin={setUser} />;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo-infinite" style={{ width: 36, height: 36 }}>
            <img src="/logo.png" alt="Instructiva" style={{ width: 30, height: 30, objectFit: "contain" }} />
          </div>
          <span className="tag">Cobrança Instructiva</span>
        </div>
        <nav className="nav">
          {NAV.map((it) => (
            <button key={it.k} className={secao === it.k ? "active" : ""} onClick={() => setSecao(it.k)}>
              <it.ico className="ico" />
              <span>{it.lb}</span>
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <div className="side-user">
            <div className="avatar">{(user.nome || "?").slice(0, 1).toUpperCase()}</div>
            <div><div className="nm">{user.nome}</div><div className="rl">{user.role}</div></div>
          </div>
          <button className="theme-toggle" onClick={toggleTheme}>
            {theme === "dark" ? <I.sun className="ico" /> : <I.moon className="ico" />}
            <span>{theme === "dark" ? "Modo claro" : "Modo escuro"}</span>
          </button>
          <button className="logout" onClick={sair}>Sair</button>
        </div>
      </aside>
      <main className="main">
        <div className="topbar"><div className="greet">Olá, {user.nome.split(" ")[0]}</div></div>
        {secao === "painel" && <PainelScreen />}
        {secao === "conversas" && <Conversas />}
        {secao === "numeros" && <Numeros />}
        {secao === "equipe" && <Equipe />}
        {secao === "ias" && <IAsScreen />}
        {secao === "disparo" && <DisparoScreen />}
        {secao === "templates" && <TemplatesScreen />}
        {secao === "acordos" && <AcordosScreen />}
        {secao === "ligacoes" && <LigacoesScreen />}
      </main>
    </div>
  );
}

const TOKEN_KEY = "instructiva_cobranca_token";

export function getToken() { return localStorage.getItem(TOKEN_KEY) || ""; }
export function setToken(t) { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); }

async function req(method, url, body) {
  const headers = { "Content-Type": "application/json" };
  const t = getToken();
  if (t) headers.Authorization = "Bearer " + t;
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) {
    const err = new Error((data && data.error) || "Erro " + res.status);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  login: (login, senha) => req("POST", "/api/login", { login, senha }),
  me: () => req("GET", "/api/me"),
  updateMe: (dados) => req("PUT", "/api/me", dados),

  listUsers: () => req("GET", "/api/users"),
  createUser: (dados) => req("POST", "/api/users", dados),
  updateUser: (id, dados) => req("PUT", "/api/users/" + id, dados),
  deleteUser: (id) => req("DELETE", "/api/users/" + id),

  // números (pool WhatsApp Cloud API)
  numeros: () => req("GET", "/api/cobranca/numeros"),
  criarNumero: (dados) => req("POST", "/api/cobranca/numeros", dados),
  editarNumero: (id, dados) => req("PUT", "/api/cobranca/numeros/" + id, dados),
  excluirNumero: (id) => req("DELETE", "/api/cobranca/numeros/" + id),
  registrarNumero: (id, pin) => req("POST", "/api/cobranca/numeros/" + id + "/registrar", { pin }),
  templates: (id) => req("GET", "/api/cobranca/numeros/" + id + "/templates"),
  criarTemplate: (id, dados) => req("POST", "/api/cobranca/numeros/" + id + "/templates", dados),
  webhookInfo: () => req("GET", "/api/cobranca/webhook-info"),

  // horário e config
  horario: () => req("GET", "/api/cobranca/horario"),
  setHorario: (h) => req("PUT", "/api/cobranca/horario", h),
  config: () => req("GET", "/api/cobranca/config"),
  setConfig: (c) => req("PUT", "/api/cobranca/config", c),

  // IAs (SDR / Negociadora)
  ias: () => req("GET", "/api/cobranca/ias"),
  criarIA: (dados) => req("POST", "/api/cobranca/ias", dados),
  editarIA: (id, dados) => req("PUT", "/api/cobranca/ias/" + id, dados),
  excluirIA: (id) => req("DELETE", "/api/cobranca/ias/" + id),
  iaGlobal: () => req("GET", "/api/cobranca/ia-global"),
  setIaGlobal: (ativa) => req("POST", "/api/cobranca/ia-global", { ativa }),
  previewIA: (dados) => req("POST", "/api/cobranca/ias/preview", dados),
  pausarIAChat: (id, pausar) => req("POST", "/api/cobranca/chats/" + id + "/ia", { pausar }),

  // disparo / campanhas
  disparar: (dados) => req("POST", "/api/cobranca/disparar", dados),
  campanhas: () => req("GET", "/api/cobranca/campanhas"),
  campanha: (id) => req("GET", "/api/cobranca/campanhas/" + id),
  retomarCampanha: (id) => req("POST", "/api/cobranca/campanhas/" + id + "/retomar"),
  excluirCampanha: (id) => req("DELETE", "/api/cobranca/campanhas/" + id),

  // conversas
  chats: (q) => req("GET", "/api/cobranca/chats" + (q ? "?q=" + encodeURIComponent(q) : "")),
  chat: (id) => req("GET", "/api/cobranca/chats/" + id),
  enviar: (id, texto) => req("POST", "/api/cobranca/chats/" + id + "/send", { texto }),
  atribuir: (id, atendenteId) => req("POST", "/api/cobranca/chats/" + id + "/atribuir", { atendenteId }),
  atendentesLista: () => req("GET", "/api/cobranca/atendentes-lista"),
  encerrar: (id, encerrar) => req("POST", "/api/cobranca/chats/" + id + "/encerrar", { encerrar }),
  setEstadoCobranca: (id, estado, detalhes) => req("POST", "/api/cobranca/chats/" + id + "/cobranca-estado", { estado, detalhes }),
  confirmarAcordo: (id, dados) => req("POST", "/api/cobranca/chats/" + id + "/acordo/confirmar", dados),
  criarAcordoManual: (id, dados) => req("POST", "/api/cobranca/chats/" + id + "/acordo", dados),

  // pós-acordo
  acordos: () => req("GET", "/api/cobranca/acordos"),
  pagarParcela: (acordoId, numero) => req("POST", "/api/cobranca/acordos/" + acordoId + "/parcelas/" + numero + "/pagar"),

  // painel / métricas
  metricas: () => req("GET", "/api/cobranca/metricas"),

  // voz (Twilio + ElevenLabs)
  vozConfig: () => req("GET", "/api/cobranca/voz-config"),
  setVozConfig: (dados) => req("PUT", "/api/cobranca/voz-config", dados),
};

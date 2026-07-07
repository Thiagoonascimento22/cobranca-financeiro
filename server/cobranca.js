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
    if (!c.config) c.config = { templateLembrete: "", templateQuebra: "", diasAntesLembrete: 2, diasCarencia: 2, diasCarenciaContatoInicial: 5 };
    if (!c.alertas) c.alertas = { ativo: false, palavras: ["boleto", "comprovante"], telefones: [], templateAlerta: "" };
    if (c.config.diasAntesLembrete === undefined) c.config.diasAntesLembrete = 2;
    if (c.config.diasCarencia === undefined) c.config.diasCarencia = 2;
    if (c.config.diasCarenciaContatoInicial === undefined) c.config.diasCarenciaContatoInicial = 5;
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
    return { id: n.id, apelido: n.apelido, numero: n.numero, phoneNumberId: n.phoneNumberId, wabaId: n.wabaId, ativo: n.ativo, temToken: !!n.token, fotoPerfilUrl: n.fotoPerfilUrl || null, iaDefaultId: n.iaDefaultId || null };
  }
  // busca (e guarda em cache) a foto do perfil comercial do WhatsApp desse número
  async function atualizarFotoPerfil(n) {
    if (!n || !n.phoneNumberId || !n.token) return;
    try {
      const r = await fetch(`${GRAPH}/${n.phoneNumberId}/whatsapp_business_profile?fields=profile_picture_url`, {
        headers: { Authorization: "Bearer " + n.token },
      });
      const data = await r.json().catch(() => ({}));
      const url = data && data.data && data.data[0] && data.data[0].profile_picture_url;
      if (url) { n.fotoPerfilUrl = url; salvar(); }
    } catch (_) { /* silencioso — foto é só cosmético, não pode travar nada */ }
  }

  function soDigitos(s) { return String(s || "").replace(/\D/g, ""); }
  function normalizaTelefone(s) {
    let d = soDigitos(s);
    if (!d) return "";
    if (!d.startsWith("55")) d = "55" + d;
    return d;
  }
  // celular brasileiro sempre tem 9 dígitos depois do DDD — a Meta às vezes manda o número
  // sem esse 9 na resposta do WhatsApp, e aí a ligação de voz (Twilio) rejeita por não bater
  // com o número verificado. Isso aqui garante o 9 antes de pedir a ligação.
  function garantirNonoDigito(numeroComPais) {
    const semPais = numeroComPais.replace(/^55/, "");
    const ddd = semPais.slice(0, 2);
    let resto = semPais.slice(2);
    if (resto.length === 8) resto = "9" + resto;
    return "55" + ddd + resto;
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

  /* alerta por palavra-chave — manda WhatsApp pro(s) responsável(is) do financeiro
     quando o aluno menciona algo configurado (ex.: "boleto", "comprovante"). Usa o mesmo
     número oficial pra enviar, então não precisa de nenhuma integração nova. */
  async function checarAlertaPalavraChave(chat, numeroCfg, textoLead) {
    garantirEstrutura();
    const cfg = db.cobranca.alertas;
    if (!cfg || !cfg.ativo || !textoLead) return;
    if (!cfg.templateAlerta) return; // sem template configurado, não tem como iniciar conversa fora da janela de 24h
    const palavras = (cfg.palavras || []).filter(Boolean);
    const telefones = (cfg.telefones || []).filter(Boolean);
    if (!palavras.length || !telefones.length) return;
    const txt = textoLead.toLowerCase();
    const bateu = palavras.find((p) => txt.includes(String(p).toLowerCase()));
    if (!bateu) return;
    if (!chat.alertasEnviados) chat.alertasEnviados = {};
    if (chat.alertasEnviados[bateu]) return; // já avisou sobre essa palavra nessa conversa, não repete
    chat.alertasEnviados[bateu] = Date.now();
    for (const tel of telefones) {
      try {
        // as variáveis do template dependem de como ele foi escrito — manda nome do aluno,
        // a palavra que bateu, e o telefone dele, nessa ordem, pros 3 primeiros {{1}} {{2}} {{3}}
        await enviarTemplate(numeroCfg, normalizaTelefone(tel), cfg.templateAlerta, "pt_BR", [chat.nome || chat.numero, bateu, chat.numero]);
      } catch (e) { console.error("[cobranca] falha ao mandar alerta pra", tel, ":", e.message); }
    }
    if (!Array.isArray(chat.notas)) chat.notas = [];
    chat.notas.push({ tipo: "alerta_enviado", texto: `Alerta automático enviado ao financeiro — aluno mencionou "${bateu}"`, ts: Date.now(), por: "Automação" });
    salvar();
  }

  /* ============================================================
     CHAT (reaproveita db.waChats, canal "oficial")
     ============================================================ */
  function chaveChat(numeroId, telefone) { return `oficial::${numeroId}::${telefone}`; }
  // núcleo do número: só os últimos 8 dígitos, pra comparar ignorando o 9º dígito
  // que o Brasil tem/não tem dependendo de como a Meta manda o "from" da resposta
  function nucleoTelefone(t) { return String(t || "").replace(/\D/g, "").slice(-8); }
  function acharChatTolerante(numeroId, telefone) {
    const exato = db.waChats[chaveChat(numeroId, telefone)];
    if (exato) return exato;
    const alvo = nucleoTelefone(telefone);
    if (!alvo) return null;
    for (const c of Object.values(db.waChats)) {
      if (!c || c.canal !== "oficial" || c.numeroOficialId !== numeroId) continue;
      if (nucleoTelefone(c.numero) === alvo) return c;
    }
    return null;
  }
  function acharOuCriarChat(numeroId, telefone, nome) {
    const existente = acharChatTolerante(numeroId, telefone);
    if (existente) {
      // atualiza pro formato mais recente que a Meta mandou, sem perder o histórico
      if (nome && (!existente.nome || existente.nome === existente.numero)) existente.nome = nome;
      return existente;
    }
    const id = chaveChat(numeroId, telefone);
    let chat = db.waChats[id];
    if (!chat) {
      const numeroCfg = acharNumero(numeroId);
      chat = {
        id, canal: "oficial", numeroOficialId: numeroId, instance: id,
        numero: telefone, nome: nome || telefone,
        mensagens: [], naoLidas: 0, atualizadoEm: Date.now(),
        atendenteId: null, estadoCobranca: "nao_contatado",
        // toda conversa nova nesse número já nasce com a IA padrão dele, se houver —
        // assim quem manda mensagem por conta própria (sem ter recebido disparo) também é atendido
        iaId: (numeroCfg && numeroCfg.iaDefaultId) || null,
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
      "application/msword": "doc",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
      "application/vnd.ms-excel": "xls",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
      "application/vnd.ms-powerpoint": "ppt",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
      "text/plain": "txt", "text/csv": "csv", "application/zip": "zip",
    };
    return map[String(mime || "").toLowerCase().split(";")[0]] || "bin";
  }
  // tira a extensão de um nome de arquivo, se tiver uma reconhecível — mais confiável
  // que adivinhar pelo mimetype, que às vezes vem genérico ou incompleto da Meta
  function extDoNome(nome) {
    const m = String(nome || "").match(/\.([a-z0-9]{2,5})$/i);
    return m ? m[1].toLowerCase() : null;
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
  async function baixarMidiaMeta(numeroCfg, mediaId, nomeOriginal) {
    if (!MEDIA_DIR || !fs || !path || !mediaId) return null;
    try {
      const r1 = await fetch(`${GRAPH}/${mediaId}`, { headers: { Authorization: "Bearer " + numeroCfg.token } });
      if (!r1.ok) { console.log("[cobranca] mídia: falha ao pegar metadados", mediaId, r1.status); return null; }
      const meta = await r1.json();
      if (!meta || !meta.url) { console.log("[cobranca] mídia: metadados sem URL", mediaId); return null; }
      const r2 = await fetch(meta.url, { headers: { Authorization: "Bearer " + numeroCfg.token } });
      if (!r2.ok) { console.log("[cobranca] mídia: falha ao baixar arquivo", mediaId, r2.status); return null; }
      const buf = Buffer.from(await r2.arrayBuffer());
      if (buf.length < 50) { console.log("[cobranca] mídia: arquivo baixado vazio/corrompido", mediaId, buf.length, "bytes"); return null; }
      const mime = meta.mime_type || "application/octet-stream";
      // prioriza a extensão do nome original (mais confiável que adivinhar pelo mimetype)
      const ext = extDoNome(nomeOriginal) || extPorMime(mime);
      const fname = "of_" + mediaId + "." + ext;
      fs.writeFileSync(path.join(MEDIA_DIR, fname), buf);
      console.log("[cobranca] mídia baixada com sucesso:", fname, buf.length, "bytes");
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
  // gera um áudio (mp3) a partir de um texto, usando a mesma chave da ElevenLabs
  // configurada em Ligações. mp3 é aceito nativamente pelo WhatsApp, sem precisar
  // converter formato (webhook de ligação usa a mesma credencial, mas isso aqui é TTS simples).
  async function gerarAudioTTS(texto) {
    garantirEstrutura();
    const v = db.cobranca.voz || {};
    if (!v.elevenApiKey) return null;
    const voiceId = v.ttsVoiceId || "21m00Tcm4TlvDq8ikWAM"; // voz padrão da ElevenLabs (Rachel), se não configurar outra
    // estabilidade baixa + boost de similaridade alto = fala mais expressiva/natural, menos "robótica";
    // estabilidade alta deixa a voz mais uniforme e monótona (é o padrão da API, por isso soa robô)
    const estabilidade = v.ttsEstabilidade !== undefined ? v.ttsEstabilidade : 0.35;
    const similaridade = v.ttsSimilaridade !== undefined ? v.ttsSimilaridade : 0.85;
    const estilo = v.ttsEstilo !== undefined ? v.ttsEstilo : 0.4;
    try {
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "xi-api-key": v.elevenApiKey, Accept: "audio/mpeg" },
        body: JSON.stringify({
          text: texto, model_id: "eleven_multilingual_v2",
          voice_settings: { stability: estabilidade, similarity_boost: similaridade, style: estilo, use_speaker_boost: true },
        }),
      });
      if (!r.ok) { console.error("[cobranca] TTS falhou:", r.status, await r.text().catch(() => "")); return null; }
      const buf = Buffer.from(await r.arrayBuffer());
      return { buffer: buf, mimetype: "audio/mpeg" };
    } catch (e) { console.error("[cobranca] TTS erro:", e.message); return null; }
  }
  function salvarMidiaLocal(buffer, mimetype, prefixo) {
    if (!MEDIA_DIR || !fs || !path) return null;
    const fname = `${prefixo}_${Date.now()}.${extPorMime(mimetype) || "bin"}`;
    fs.writeFileSync(path.join(MEDIA_DIR, fname), buffer);
    return fname;
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
    // atualiza foto em segundo plano pra quem ainda não tem (não atrasa a resposta)
    (db.cobranca.numeros || []).forEach((n) => { if (!n.fotoPerfilUrl) atualizarFotoPerfil(n); });
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
      ativo: true, iaDefaultId: b.iaDefaultId || null,
    };
    db.cobranca.numeros.push(novo);
    await assinarWebhook(novo);
    salvar();
    res.json(numeroPublico(novo));
    atualizarFotoPerfil(novo);
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
    if (b.iaDefaultId !== undefined) n.iaDefaultId = b.iaDefaultId || null;
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
    // a Meta exige um "exemplo" pra cada variável {{n}} do corpo, senão recusa a criação —
    // gera exemplos genéricos automaticamente, sem precisar o usuário preencher isso na mão
    const numVars = new Set((corpo.match(/\{\{(\d+)\}\}/g) || []).map((m) => m.replace(/\D/g, ""))).size;
    const exemplos = Array.from({ length: numVars }, (_, i) => `exemplo${i + 1}`);
    const bodyComponent = { type: "BODY", text: corpo };
    if (numVars > 0) bodyComponent.example = { body_text: [exemplos] };
    try {
      const r = await fetch(`${GRAPH}/${n.wabaId}/message_templates`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + n.token },
        body: JSON.stringify({
          name: nome, language: idioma,
          category: ["MARKETING", "AUTHENTICATION"].includes(categoria) ? categoria : "UTILITY",
          components: [bodyComponent],
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        const err = data.error || {};
        const detalhe = err.error_user_msg || err.error_user_title || err.message || ("Erro Graph " + r.status);
        console.log("[cobranca] erro ao criar template — resposta completa da Meta:", JSON.stringify(err));
        return res.status(400).json({ error: detalhe });
      }
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
  app.get("/api/cobranca/alertas", auth, gerenteOnly, (req, res) => { garantirEstrutura(); res.json(db.cobranca.alertas); });
  app.put("/api/cobranca/alertas", auth, gerenteOnly, (req, res) => {
    garantirEstrutura();
    const b = req.body || {};
    const a = db.cobranca.alertas;
    if (b.ativo !== undefined) a.ativo = !!b.ativo;
    if (Array.isArray(b.palavras)) a.palavras = b.palavras.map((p) => lim(String(p || "").trim(), 40)).filter(Boolean).slice(0, 30);
    if (Array.isArray(b.telefones)) a.telefones = b.telefones.map((t) => soDigitos(t)).filter(Boolean).slice(0, 10);
    if (b.templateAlerta !== undefined) a.templateAlerta = lim(b.templateAlerta, 100);
    salvar();
    res.json(a);
  });
  app.put("/api/cobranca/config", auth, gerenteOnly, (req, res) => {
    garantirEstrutura();
    const b = req.body || {};
    const c = db.cobranca.config;
    if (b.templateLembrete !== undefined) c.templateLembrete = lim(b.templateLembrete, 200);
    if (b.templateQuebra !== undefined) c.templateQuebra = lim(b.templateQuebra, 200);
    if (b.diasAntesLembrete !== undefined) c.diasAntesLembrete = Math.max(0, Math.min(10, Number(b.diasAntesLembrete) || 2));
    if (b.diasCarencia !== undefined) c.diasCarencia = Math.max(0, Math.min(15, Number(b.diasCarencia) || 2));
    if (b.diasCarenciaContatoInicial !== undefined) c.diasCarenciaContatoInicial = Math.max(0, Math.min(30, Number(b.diasCarenciaContatoInicial) || 5));
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
      respostaAudio: false, // se true, essa IA responde por áudio (voz gerada) em vez de texto
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
    c.respostaAudio = !!b.respostaAudio;
    return c;
  }
  function sanitizaConhecimento(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, 60).map((k) => ({
      id: k.id || proximoId("kb"), secao: lim(k.secao || "geral", 30),
      nome: lim(k.nome, 200), texto: lim(k.texto, 200000), criadoEm: k.criadoEm || Date.now(),
    }));
  }
  function normalizaPapel(p) { return (p === "negociadora" || p === "completa") ? p : "sdr"; }

  function blocoComplianceEDadosDivida(nomeLead, divida, dividas) {
    const P = [];
    const hoje = new Date();
    const hojeISO = hoje.toISOString().slice(0, 10);
    const hojeExtenso = hoje.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric", timeZone: "America/Sao_Paulo" });
    P.push(`DATA DE HOJE: ${hojeExtenso} (${hojeISO}). Use essa data como referência real pra calcular qualquer prazo, vencimento ou "mês que vem" — NUNCA calcule data de cabeça sem se basear nela, e NUNCA proponha ou registre uma data de vencimento anterior a hoje.`);
    if (nomeLead) P.push(`O nome do aluno com quem você fala é: ${nomeLead}.`);

    if (Array.isArray(dividas) && dividas.length > 1) {
      // aluno tem VÁRIOS boletos/meses em aberto — lista todos, não só um
      const linhasBoletos = dividas.map((d, i) => {
        const atraso = diasDeAtraso(d.vencimento);
        const situacao = d.pago ? "PAGO" : atraso === null ? "sem data" : atraso > 0 ? `${atraso} dia(s) em atraso` : atraso < 0 ? "ainda não venceu" : "vence hoje";
        return `  ${i + 1}. ${d.vencimento ? fmtDataBR(d.vencimento) : "(sem data)"} — ${d.valor ? fmtMoedaBR(d.valor) : "(sem valor)"} — ${situacao}`;
      });
      const totalPendente = dividas.filter((d) => !d.pago).reduce((s, d) => s + (d.valor || 0), 0);
      P.push(`\nBOLETOS/MESES DESSE ALUNO (use exatamente esses valores e datas, nunca invente):\n${linhasBoletos.join("\n")}\n  Total pendente somando todos: ${fmtMoedaBR(totalPendente)}`);
      if (divida && divida.curso) P.push(`Curso do aluno: ${divida.curso}`);
      P.push(`\nIMPORTANTE SOBRE VÁRIOS BOLETOS: lembre o aluno de forma clara quais meses estão pendentes (não só o mais atrasado). Você pode propor negociar os meses futuros também (antecipar, parcelar tudo junto, etc.), não só o mais vencido. Sempre que falar de valor, deixe claro a qual mês/boleto se refere.`);
    } else if (divida && (divida.valor || divida.vencimento)) {
      const atraso = diasDeAtraso(divida.vencimento);
      const linhas = [];
      if (divida.valor) linhas.push(`Valor em aberto: ${fmtMoedaBR(divida.valor)}`);
      if (divida.vencimento) linhas.push(`Vencimento original: ${fmtDataBR(divida.vencimento)}`);
      if (atraso !== null) linhas.push(`Dias de atraso até hoje: ${atraso >= 0 ? atraso : 0}${atraso < 0 ? " (ainda não venceu, é um lembrete preventivo)" : ""}`);
      if (divida.curso) linhas.push(`Curso do aluno: ${divida.curso}`);
      P.push(`\nDADOS DESTA COBRANÇA (use exatamente essas informações, nunca invente ou arredonde — inclusive se o aluno perguntar "qual curso mesmo?", responda com o nome exato daqui):\n- ${linhas.join("\n- ")}`);
    } else {
      P.push(`\nATENÇÃO: não há dados de dívida carregados pra esse contato. NÃO invente valor, vencimento ou qualquer dado financeiro.`);
    }
    P.push(`\nREGRAS DE COMPLIANCE (LGPD / CDC — inegociáveis):`);
    P.push(`- NUNCA exponha a dívida ou dados do aluno pra terceiros (família, colegas, quem responder no lugar dele).`);
    P.push(`- NUNCA use tom de ameaça, constrangimento ou pressão abusiva. Não use "negativação", "protesto" ou "ação judicial" como ameaça.`);
    P.push(`- NUNCA confirme ou negue dívida pra alguém que não comprovou ser o titular.`);
    P.push(`\nÁUDIO OU TEXTO: por padrão você responde em texto. Se o aluno pedir explicitamente pra você responder por áudio/voz (de qualquer jeito que ele formular isso), inclua a tag [MODO_AUDIO] no final da sua resposta. Se o aluno pedir pra você parar de mandar áudio e voltar a escrever (de qualquer jeito que ele formular isso — "não consigo ouvir", "manda por texto", "sem áudio", etc.), inclua a tag [MODO_TEXTO] no final. Essas tags nunca aparecem pro aluno.`);
    P.push(`\nMENSAGENS SEPARADAS: pessoas de verdade no WhatsApp mandam vários balões curtos, não um texto único. Se sua resposta tiver mais de uma ideia (ex.: uma confirmação + uma pergunta, ou uma explicação + uma proposta), separe cada balão com uma linha em branco entre eles — cada bloco separado por linha em branco vira uma mensagem própria. Não abuse: no máximo 2-3 balões por resposta, cada um curto.`);
    P.push(`\nSTATUS DA CONVERSA: em TODA resposta, no final de tudo (depois de qualquer outra tag), inclua a tag [STATUS: resumo] com um resumo curto (uma frase, máximo ~15 palavras) de onde a conversa está agora — o que já foi combinado, o que falta, ou o que você está esperando do aluno. Exemplos: [STATUS: aluno confirmou identidade, ainda não disse o motivo do atraso], [STATUS: aluno disse que paga até sexta, aguardando comprovante], [STATUS: aluno pediu desconto maior que o permitido, escalado pro humano]. Essa tag nunca aparece pro aluno — é só controle interno.`);
    return P.join("\n");
  }

  // IA 1 — SDR: entende o motivo da inadimplência, coleta informações, e decide se
  // encaminha pra Negociadora (lead disposto a resolver) ou direto pro humano (caso complexo/disputa)
  function montarPromptSDR(ia, nomeLead, divida, dividas) {
    const c = ia.config || {};
    const P = [];
    P.push(`Você é ${ia.nome}, atendente do setor financeiro da Escola Instructiva, primeiro contato pelo WhatsApp com um aluno em atraso de pagamento.`);
    P.push(`Seu tom de voz é ${TOM_LABEL[c.tomVoz] || "profissional"}, sempre respeitoso.`);
    P.push(`\nSEU OBJETIVO (você NÃO negocia valores nem propõe parcelamento — isso é outra etapa): confirmar que fala com a pessoa certa, entender o MOTIVO do atraso (dificuldade financeira, esqueceu, discorda da cobrança, etc.) e sinalizar se o aluno está disposto a regularizar.`);
    if (c.objetivo) P.push(c.objetivo);
    P.push(blocoComplianceEDadosDivida(nomeLead, divida, dividas));
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
    P.push(`\nREGRA DA PASSAGEM: o aluno NÃO PERCEBE a troca de atendente, seja pra negociação ou pro humano. PROIBIDO usar as palavras "transferir", "encaminhar", "equipe", "setor", "chamar alguém", "outra pessoa" ou qualquer variação que sugira que outra pessoa/IA vai assumir. Sua última mensagem antes da tag deve soar como você mesma dando continuidade — uma pergunta ou comentário natural${c.escFrase ? `, por exemplo: "${c.escFrase}"` : ', por exemplo: "Que bom! Deixa eu ver as melhores opções pra você" ou "Perfeito, já te passo como fica"'}. As tags nunca aparecem pro aluno.`);
    if (c.encerrarCriterios) P.push(`\nEncerre/pare de insistir quando: ${c.encerrarCriterios}`);
    P.push(`\nREGRAS GERAIS: mensagens curtas de WhatsApp, uma ideia por vez, nunca diga que é IA. Nunca invente valores ou datas. Nome do aluno só se confirmado. Emojis simples e raros (🙂 😊 👍).`);
    return P.join("\n");
  }

  // IA 2 — Negociadora: já assumiu que o aluno quer resolver; apresenta propostas
  // dentro das regras configuradas; fecha (propõe formalmente) ou escala pro humano
  function montarPromptNegociadora(ia, nomeLead, divida, motivo, dividas) {
    const c = ia.config || {};
    const P = [];
    P.push(`Você é ${ia.nome}, negociadora do setor financeiro da Escola Instructiva, dando continuidade a uma conversa de cobrança pelo WhatsApp — o aluno já confirmou identidade e disposição pra resolver a pendência.`);
    P.push(`Seu tom de voz é ${TOM_LABEL[c.tomVoz] || "profissional"}, sempre respeitoso e resolutivo.`);
    if (c.objetivo) P.push(`SEU OBJETIVO: ${c.objetivo}`);
    else P.push(`SEU OBJETIVO: apresentar as formas de pagamento e fechar um acordo dentro das regras abaixo.`);
    if (motivo) P.push(`\nO motivo do atraso que o aluno relatou anteriormente: ${motivo}. Use isso com empatia, sem ficar repetindo.`);
    P.push(blocoComplianceEDadosDivida(nomeLead, divida, dividas));
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
    P.push(`\nREGRA DA PASSAGEM: o aluno NÃO PERCEBE a troca. PROIBIDO usar "transferir", "encaminhar", "equipe", "setor" ou qualquer palavra que sugira outra pessoa assumindo. Última mensagem antes da tag soa como você mesma continuando${c.escFrase ? `, ex.: "${c.escFrase}"` : ', ex.: "Deixa eu confirmar isso rapidinho" ou "Perfeito, já te retorno com os detalhes"'}.`);
    if (c.encerrarCriterios) P.push(`\nEncerre/pare de insistir quando: ${c.encerrarCriterios}`);
    P.push(`\nREGRAS GERAIS: mensagens curtas de WhatsApp, nunca diga que é IA, nunca invente valores/datas/links fora do que está acima. Emojis simples e raros.`);
    return P.join("\n");
  }

  // IA ÚNICA — qualifica e negocia na mesma conversa, sem passagem entre "cérebros".
  // Mais simples de configurar, mas sem a trava de nunca falar de dinheiro antes de qualificar.
  function montarPromptCompleta(ia, nomeLead, divida, dividas) {
    const c = ia.config || {};
    const P = [];
    P.push(`Você é ${ia.nome}, atendente do setor financeiro da Escola Instructiva, falando pelo WhatsApp com um aluno em atraso de pagamento. Você cuida da conversa do início ao fim: confirma identidade, entende o motivo do atraso, e conduz a negociação dentro das regras abaixo.`);
    P.push(`Seu tom de voz é ${TOM_LABEL[c.tomVoz] || "profissional"}, sempre respeitoso.`);
    if (c.objetivo) P.push(`SEU OBJETIVO: ${c.objetivo}`);
    P.push(blocoComplianceEDadosDivida(nomeLead, divida, dividas));
    if (c.quemEla) P.push(`\nQUEM VOCÊ É:\n${c.quemEla}`);
    if (c.comoEscreve) P.push(`\nCOMO VOCÊ ESCREVE:\n${c.comoEscreve}`);
    if (c.sempreFaz) P.push(`\nVOCÊ SEMPRE:\n${c.sempreFaz}`);
    if (c.nuncaFaz) P.push(`\nVOCÊ NUNCA:\n${c.nuncaFaz}`);

    P.push(`\nORDEM OBRIGATÓRIA DA CONVERSA — não pule etapas:`);
    P.push(`1. Primeiro confirme que fala com o aluno certo.`);
    P.push(`2. Depois pergunte com empatia o motivo do atraso — NÃO fale de valores, desconto ou parcelamento antes disso.`);
    P.push(`3. Só depois que o aluno demonstrar disposição de resolver (ex.: "quero pagar", "como faço") é que você entra na negociação, seguindo as regras abaixo.`);

    const regrasNeg = [];
    if (c.formasPagamento) regrasNeg.push(`Formas de pagamento aceitas: ${c.formasPagamento}`);
    if (c.parcelamentoMax) regrasNeg.push(`Pode oferecer parcelamento em até ${c.parcelamentoMax}x sem aprovação humana.`);
    else regrasNeg.push(`NÃO pode oferecer parcelamento por conta própria — qualquer pedido de parcelas vai pra [PASSAR_HUMANO].`);
    if (c.descontoMaximoPct) regrasNeg.push(`Pode oferecer no máximo ${c.descontoMaximoPct}% de desconto à vista sozinho(a). Desconto maior exige [PASSAR_HUMANO].`);
    else regrasNeg.push(`NÃO pode oferecer desconto nenhum sozinho(a) — qualquer pedido de desconto vai pra [PASSAR_HUMANO].`);
    if (c.regrasNegociacao) regrasNeg.push(c.regrasNegociacao);
    P.push(`\nREGRAS DE NEGOCIAÇÃO (limite da sua autonomia):\n- ${regrasNeg.join("\n- ")}`);

    if (c.objecoes && c.objecoes.length) {
      P.push(`\nCOMO RESPONDER OBJEÇÕES:`);
      c.objecoes.forEach((o) => { if (o.objecao) P.push(`- Se disser "${o.objecao}": ${o.resposta || ""}`); });
    }
    if (c.faq && c.faq.length) {
      P.push(`\nPERGUNTAS FREQUENTES:`);
      c.faq.forEach((q) => { if (q.pergunta) P.push(`- P: ${q.pergunta}\n  R: ${q.resposta || ""}`); });
    }
    const etapas = [
      ["Abertura", c.pbAbertura], ["Confirmação de identidade", c.pbConfirmacao], ["Coleta do motivo", c.pbColeta],
      ["Apresentação das opções de pagamento", c.pbNegociacao], ["Fechamento", c.pbFechamento], ["Recuperação (se sumir)", c.pbRecuperacao],
    ].filter(([, v]) => v);
    if (etapas.length) { P.push(`\nROTEIRO:`); etapas.forEach(([t, v], i) => P.push(`${i + 1}. ${t}: ${v}`)); }
    const kb = (ia.conhecimento || []).filter((k) => k.texto);
    if (kb.length) { P.push(`\nBASE DE CONHECIMENTO:`); kb.forEach((k) => P.push(`\n--- ${k.nome} ---\n${lim(k.texto, 40000)}`)); }

    P.push(`\nQUANDO O ALUNO ACEITAR UMA CONDIÇÃO DENTRO DAS SUAS REGRAS: confirme os números com clareza e finalize com a tag [ACORDO_PROPOSTO: parcelas=N; valor_parcela=V; vencimento=YYYY-MM-DD] no final (nunca visível pro aluno).`);
    P.push(`\nQUANDO PASSAR PRA UM HUMANO (tag [PASSAR_HUMANO] no final): disputa da dívida, pedido fora do seu limite de autonomia, menção a Procon/advogado/ação judicial, hostilidade, ou pedido explícito de falar com uma pessoa.`);
    if (c.escQuando) P.push(`Além disso: ${c.escQuando}`);
    P.push(`\nREGRA DA PASSAGEM: o aluno NÃO PERCEBE a troca. PROIBIDO usar "transferir", "encaminhar", "equipe", "setor" ou qualquer palavra que sugira outra pessoa assumindo. Última mensagem antes da tag soa como você mesma continuando${c.escFrase ? `, ex.: "${c.escFrase}"` : ', ex.: "Deixa eu confirmar isso rapidinho" ou "Perfeito, já te retorno com os detalhes"'}.`);
    if (c.encerrarCriterios) P.push(`\nEncerre/pare de insistir quando: ${c.encerrarCriterios}`);
    P.push(`\nREGRAS GERAIS: mensagens curtas de WhatsApp, nunca diga que é IA, nunca invente valores/datas. Nome do aluno só se confirmado. Emojis simples e raros.`);
    return P.join("\n");
  }

  function montarSystemPrompt(ia, chat) {
    const nomeLead = chat ? chat.nome : "";
    const divida = chat ? chat.divida : null;
    const dividas = chat ? chat.dividas : null;
    const motivo = chat ? chat.motivoInadimplencia : "";
    if (ia.papel === "negociadora") return montarPromptNegociadora(ia, nomeLead, divida, motivo, dividas);
    if (ia.papel === "completa") return montarPromptCompleta(ia, nomeLead, divida, dividas);
    return montarPromptSDR(ia, nomeLead, divida, dividas);
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
  // separa a resposta em várias mensagens curtas, do jeito que uma pessoa de verdade
  // manda no WhatsApp — a IA já separa os "blocos" com linha em branco (instrução no
  // prompt); aqui só garante que nunca manda um textão só numa bolha.
  function dividirEmMensagens(texto) {
    let blocos = texto.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
    if (blocos.length <= 1) {
      // a IA não separou — tenta quebrar por frase se o texto for longo (>220 caracteres)
      const unico = blocos[0] || texto.trim();
      if (unico.length > 220) {
        const frases = unico.match(/[^.!?]+[.!?]+(\s|$)/g) || [unico];
        blocos = [];
        let atual = "";
        for (const f of frases) {
          if ((atual + f).length > 160 && atual) { blocos.push(atual.trim()); atual = ""; }
          atual += f;
        }
        if (atual.trim()) blocos.push(atual.trim());
      } else {
        blocos = [unico];
      }
    }
    return blocos.slice(0, 5); // limite de segurança, nunca manda mais que 5 mensagens de uma vez
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
      console.log(`[cobranca] rodarIA chamada — chat=${chat.id} iaId=${chat.iaId || "(nenhuma)"} iaPausada=${!!chat.iaPausada} iaGlobalAtiva=${db.cobranca.iaGlobalAtiva !== false}`);
      if (db.cobranca.iaGlobalAtiva === false) { console.log("[cobranca] rodarIA abortou: botão de pânico geral está desligado"); return; }
      const ia = (db.cobranca.ias || []).find((x) => x.id === chat.iaId);
      if (!ia) { console.log(`[cobranca] rodarIA abortou: chat.iaId=${chat.iaId} não corresponde a nenhuma IA cadastrada`); return; }
      if (!ia.ativa) { console.log(`[cobranca] rodarIA abortou: IA "${ia.nome}" está marcada como pausada (ativa=false)`); return; }
      console.log(`[cobranca] rodarIA chamando o modelo pra IA "${ia.nome}" (papel=${ia.papel})`);
      const system = montarSystemPrompt(ia, chat);
      const histDireto = (chat.mensagens || []).slice(-24);
      let resposta = await chamarModelo(system, histDireto);
      if (!resposta) { console.log("[cobranca] rodarIA: o modelo devolveu resposta vazia"); return; }
      console.log(`[cobranca] rodarIA: resposta recebida do modelo (${resposta.length} caracteres), enviando...`);

      let passarHumano = false, passarNegociadora = false, acordoProposto = null;

      if (resposta.includes("[PASSAR_HUMANO]")) { passarHumano = true; resposta = resposta.replace(/\[PASSAR_HUMANO\]/g, "").trim(); }
      if (resposta.includes("[PASSAR_NEGOCIADORA]")) { passarNegociadora = true; resposta = resposta.replace(/\[PASSAR_NEGOCIADORA\]/g, "").trim(); }
      let pedirModoTexto = false, pedirModoAudio = false;
      if (resposta.includes("[MODO_TEXTO]")) { pedirModoTexto = true; resposta = resposta.replace(/\[MODO_TEXTO\]/g, "").trim(); }
      if (resposta.includes("[MODO_AUDIO]")) { pedirModoAudio = true; resposta = resposta.replace(/\[MODO_AUDIO\]/g, "").trim(); }
      const mStatus = resposta.match(/\[STATUS:\s*([^\]]+)\]/i);
      if (mStatus) {
        chat.statusResumo = mStatus[1].trim();
        chat.statusResumoEm = Date.now();
        resposta = resposta.replace(mStatus[0], "").trim();
      }
      const mMotivo = resposta.match(/\[MOTIVO:\s*([^\]]+)\]/i);
      if (mMotivo) { chat.motivoInadimplencia = lim(mMotivo[1], 500); resposta = resposta.replace(/\[MOTIVO:[^\]]+\]/i, "").trim(); }
      const mAcordo = resposta.match(/\[ACORDO_PROPOSTO:\s*parcelas=(\d+);\s*valor_parcela=([\d.,]+);\s*vencimento=(\d{4}-\d{2}-\d{2})\]/i);
      if (mAcordo) {
        const vencProposto = mAcordo[3];
        const hojeISOAgora = new Date().toISOString().slice(0, 10);
        const diasDiferenca = Math.round((new Date(vencProposto + "T00:00:00-03:00") - new Date(hojeISOAgora + "T00:00:00-03:00")) / 86400000);
        // trava de segurança: nunca aceita data no passado nem absurdamente longe (>120 dias) —
        // isso pega alucinação de data da IA (ex.: propor vencimento em 2023, ou ano errado)
        // antes de virar um acordo de verdade. Em vez de registrar errado, escala pro humano.
        if (diasDiferenca < 0 || diasDiferenca > 120) {
          resposta = resposta.replace(mAcordo[0], "").trim();
          passarHumano = true;
          if (!Array.isArray(chat.notas)) chat.notas = [];
          chat.notas.push({ tipo: "acordo_data_suspeita", texto: `⚠️ A IA tentou propor um acordo com vencimento em ${vencProposto} (${diasDiferenca} dias a partir de hoje) — data suspeita, bloqueada automaticamente e escalada pra revisão humana.`, ts: Date.now(), por: "Automação" });
        } else {
          acordoProposto = { parcelas: mAcordo[1], valorParcela: mAcordo[2].replace(",", "."), vencimento: vencProposto };
          resposta = resposta.replace(mAcordo[0], "").trim();
        }
      }

      // rede de segurança por palavra-chave (não depende só do modelo lembrar da tag)
      const ultLead = [...(chat.mensagens || [])].reverse().find((m) => m.role === "them");
      const txtLead = ((ultLead && (ultLead.transcricao || ultLead.content)) || "").toLowerCase();
      if (!passarHumano) {
        if (SINAIS_ESCALONAMENTO.some((s) => txtLead.includes(s))) passarHumano = true;
      }

      // decide se essa resposta vai por áudio: só quando o recurso está ligado na IA E
      // (o lead pediu áudio, ou o lead mandou áudio) — nunca por padrão. Se o lead pedir
      // texto explicitamente, guarda essa preferência na conversa e passa a respeitar sempre.
      // Prioridade 1: a própria IA já entendeu o pedido e avisou com a tag (mais confiável,
      // não depende de adivinhar toda variação de frase possível).
      // Prioridade 2: rede de segurança por palavra-chave, caso a IA esqueça a tag.
      if (pedirModoTexto) chat.prefereAudio = false;
      else if (pedirModoAudio) chat.prefereAudio = true;
      else {
        const PEDIU_TEXTO = ["manda texto", "manda por texto", "pode escrever", "por escrito", "não consigo ouvir", "nao consigo ouvir", "não posso ouvir", "nao posso ouvir", "não dá pra ouvir", "nao da pra ouvir", "não escuto", "nao escuto", "sem áudio", "sem audio", "não manda áudio", "nao manda audio", "não manda mais áudio", "nao manda mais audio", "só texto", "so texto", "prefiro texto", "pode ser texto", "responde em texto", "fala por texto", "sem voz"];
        const PEDIU_AUDIO = ["manda áudio", "manda audio", "pode falar", "manda um áudio", "manda um audio", "fala por áudio", "fala por audio", "manda voz", "responde em áudio", "responde em audio", "prefiro áudio", "prefiro audio", "quero ouvir"];
        if (PEDIU_TEXTO.some((s) => txtLead.includes(s))) chat.prefereAudio = false;
        else if (PEDIU_AUDIO.some((s) => txtLead.includes(s))) chat.prefereAudio = true;
      }

      const respostaAudioHabilitada = !!(ia.config && ia.config.respostaAudio);
      const leadMandouAudio = ultLead && ultLead.tipo === "audio";
      const deveResponderAudio = respostaAudioHabilitada && chat.prefereAudio !== false && (chat.prefereAudio === true || leadMandouAudio);

      if (resposta) {
        const espera = tempoDigitacao(resposta);
        await mostrarDigitando(numeroCfg, chat.ultimaMsgLeadId);
        await new Promise((r) => setTimeout(r, espera));
        let enviouAudio = false;
        if (deveResponderAudio) {
          const audio = await gerarAudioTTS(resposta);
          if (audio) {
            try {
              const mediaId = await uploadMidiaMeta(numeroCfg, audio.buffer, audio.mimetype, "resposta");
              await enviarMidiaOficial(numeroCfg, chat.numero, "audio", mediaId);
              const arquivo = salvarMidiaLocal(audio.buffer, audio.mimetype, "ia");
              const ts = Date.now();
              chat.mensagens.push({ role: "me", content: resposta, ts, porIA: true, tipo: "audio", arquivo, mimetype: audio.mimetype });
              chat.atualizadoEm = ts;
              enviouAudio = true;
            } catch (e) { console.error("[cobranca] falha ao enviar áudio da IA, caindo pra texto:", e.message); }
          }
        }
        if (!enviouAudio) {
          const blocos = dividirEmMensagens(resposta);
          for (let i = 0; i < blocos.length; i++) {
            if (i > 0) {
              // pausa curta entre uma mensagem e outra, como alguém digitando de novo
              await mostrarDigitando(numeroCfg, chat.ultimaMsgLeadId);
              await new Promise((r) => setTimeout(r, 1200 + Math.random() * 1200));
            }
            await enviarTextoOficial(numeroCfg, chat.numero, blocos[i]);
            const ts = Date.now();
            chat.mensagens.push({ role: "me", content: blocos[i], ts, porIA: true });
            chat.atualizadoEm = ts;
          }
        }
        if (chat.mensagens.length > 300) chat.mensagens = chat.mensagens.slice(-300);
      }

      if (!Array.isArray(chat.notas)) chat.notas = [];

      let precisaContinuarComProximaIA = false;

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
        precisaContinuarComProximaIA = true; // a Negociadora já continua na hora, sem esperar o aluno falar de novo
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

      if (precisaContinuarComProximaIA) {
        await rodarIA(chat, numeroCfg); // chama a Negociadora imediatamente, usando o mesmo histórico
      }
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
    const b = req.body || {};
    if (!Array.isArray(chat.notas)) chat.notas = [];
    // atribuir/trocar qual IA cuida dessa conversa (funciona mesmo sem ter vindo de um disparo)
    if (b.iaId !== undefined) {
      if (b.iaId === null || b.iaId === "") {
        chat.iaId = null;
        chat.notas.push({ tipo: "ia_removida", texto: `${req.user.nome} removeu a IA dessa conversa`, ts: Date.now(), por: req.user.nome });
      } else {
        const ia = (db.cobranca.ias || []).find((x) => x.id === b.iaId);
        if (!ia) return res.status(400).json({ error: "IA não encontrada" });
        chat.iaId = ia.id;
        chat.iaPausada = false;
        chat.notas.push({ tipo: "ia_atribuida", texto: `${req.user.nome} atribuiu a IA "${ia.nome}" a essa conversa`, ts: Date.now(), por: req.user.nome });
        salvar();
        return res.json({ ok: true, iaId: chat.iaId, iaPausada: chat.iaPausada });
      }
    }
    const pausar = !!b.pausar;
    chat.iaPausada = pausar;
    chat.notas.push({ tipo: pausar ? "ia_pausada" : "ia_retomada", texto: `${req.user.nome} ${pausar ? "pausou a IA e assumiu" : "devolveu o atendimento pra IA"}`, ts: Date.now(), por: req.user.nome });
    salvar();
    res.json({ ok: true, iaId: chat.iaId, iaPausada: chat.iaPausada });
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
    if (d.curso) out.curso = lim(d.curso, 120);
    if (d.cpf) out.cpf = lim(String(d.cpf).replace(/[^\d]/g, ""), 14);
    if (d.email) out.email = lim(String(d.email).trim(), 120);
    return Object.keys(out).length ? out : null;
  }
  // valida a lista de boletos de um mesmo aluno (várias parcelas/meses diferentes) —
  // cada item é só valor+vencimento, os outros dados (curso, cpf, email) ficam no contato
  function sanitizaDividas(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map((d) => {
      if (!d) return null;
      const out = {};
      if (d.valor !== undefined && d.valor !== "") out.valor = Number(d.valor) || 0;
      if (d.vencimento) out.vencimento = lim(d.vencimento, 10);
      if (!out.valor && !out.vencimento) return null;
      out.pago = !!d.pago;
      return out;
    }).filter(Boolean).slice(0, 10);
  }
  // escolhe o boleto mais relevante de uma lista pra usar como "resumo" (compatibilidade
  // com telas/automação que só olham um valor/vencimento só) — o próximo pendente por data
  function proximoPendente(dividas) {
    if (!Array.isArray(dividas) || !dividas.length) return null;
    const pendentes = dividas.filter((d) => !d.pago && d.vencimento);
    if (!pendentes.length) return dividas[0];
    return pendentes.slice().sort((a, b) => a.vencimento.localeCompare(b.vencimento))[0];
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
    const iaId = String(b.iaId || numeroCfg.iaDefaultId || "").trim();
    const iaCampanha = iaId ? (db.cobranca.ias || []).find((x) => x.id === iaId && x.ativa) : null;
    if (iaId && !iaCampanha) return res.status(400).json({ error: "IA selecionada não existe ou está pausada" });

    const campanha = {
      id: proximoId("camp"), nome: String(b.nomeCampanha || templateName).trim(),
      numeroId: numeroCfg.id, template: templateName, idioma,
      iaId: iaCampanha ? iaCampanha.id : null, iaNome: iaCampanha ? iaCampanha.nome : null,
      enviados: 0, entregues: 0, lidos: 0, responderam: 0, falhas: 0, total: contatos.length,
      pendentes: contatos.map((c) => ({
        telefone: c.telefone, nome: c.nome || "", variaveis: c.variaveis || [],
        divida: sanitizaDivida(c.divida),
        dividas: sanitizaDividas(c.dividas),
      })),
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
      if (campanha.status === "cancelando") break; // usuário pediu pra cancelar — para antes do próximo envio
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
        if (c.dividas && c.dividas.length) {
          chat.dividas = c.dividas;
          const prox = proximoPendente(c.dividas);
          chat.divida = { ...(c.divida || {}), ...(prox || {}) }; // mantém curso/cpf/email do c.divida, valor/vencimento do próximo pendente
        } else if (c.divida) {
          chat.divida = c.divida;
        }
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
    const foiCancelada = campanha.status === "cancelando";
    campanha.status = foiCancelada ? "cancelada" : "concluida";
    campanha._rodando = false;
    if (foiCancelada) {
      const restantes = (campanha.pendentes || []).length;
      campanha.notaCancelamento = `Cancelada com ${restantes} contato(s) que ainda não tinham recebido`;
      // não apaga campanha.pendentes de propósito — dá pra retomar depois, se quiser
    } else {
      delete campanha.pendentes;
    }
    salvar();
  }

  app.post("/api/cobranca/campanhas/:id/cancelar", auth, gerenteOnly, (req, res) => {
    const campanha = (db.cobranca.campanhas || []).find((x) => x.id === req.params.id);
    if (!campanha) return res.status(404).json({ error: "Campanha não encontrada" });
    if (!campanha.pendentes || !campanha.pendentes.length) return res.status(400).json({ error: "Essa campanha já terminou, não tem mais o que cancelar" });
    campanha.status = "cancelando"; // o loop em andamento vê isso e para sozinho, no máximo em alguns segundos
    salvar();
    res.json({ ok: true });
  });

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
    const campanhaId = req.params.id;
    const antes = (db.cobranca.campanhas || []).length;
    db.cobranca.campanhas = (db.cobranca.campanhas || []).filter((x) => x.id !== campanhaId);
    // remove junto as conversas que nasceram dessa campanha — senão fica "órfã", com iaId/estado
    // apontando pra uma campanha que não existe mais, e confunde teste/uso depois
    let conversasRemovidas = 0;
    for (const chatId of Object.keys(db.waChats)) {
      const c = db.waChats[chatId];
      if (c && c.campanhaId === campanhaId) { delete db.waChats[chatId]; conversasRemovidas++; }
    }
    if (db.cobranca.msgCampanha) {
      for (const mid of Object.keys(db.cobranca.msgCampanha)) {
        if (db.cobranca.msgCampanha[mid] === campanhaId) delete db.cobranca.msgCampanha[mid];
      }
    }
    salvar();
    res.json({ ok: true, removida: antes !== db.cobranca.campanhas.length, conversasRemovidas });
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
        vencimentoEstourado: !!c.vencimentoEstourado,
        statusResumo: c.statusResumo || null,
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

  /* humano grava um áudio no navegador e manda como mensagem de voz */
  app.post("/api/cobranca/chats/:id/send-audio", auth, async (req, res) => {
    const chat = db.waChats[req.params.id];
    if (!chat || chat.canal !== "oficial") return res.status(404).json({ error: "Conversa não encontrada" });
    if (req.user.role !== "gerente" && chat.atendenteId !== req.user.id) return res.status(403).json({ error: "Sem acesso a essa conversa" });
    const numeroCfg = acharNumero(chat.numeroOficialId);
    if (!numeroCfg) return res.status(400).json({ error: "Número não encontrado" });
    const b = req.body || {};
    if (!b.audioBase64) return res.status(400).json({ error: "Áudio vazio" });
    try {
      const buffer = Buffer.from(b.audioBase64, "base64");
      const mimetype = b.mimetype || "audio/ogg";
      const mediaId = await uploadMidiaMeta(numeroCfg, buffer, mimetype, "gravacao");
      await enviarMidiaOficial(numeroCfg, chat.numero, "audio", mediaId);
      const arquivo = salvarMidiaLocal(buffer, mimetype, "humano");
      const ts = Date.now();
      chat.mensagens.push({ role: "me", content: "🎤 Áudio", ts, tipo: "audio", arquivo, mimetype });
      chat.atualizadoEm = ts;
      salvar();
      res.json({ ok: true });
    } catch (e) {
      // formatos de áudio gravados no navegador nem sempre são aceitos pelo WhatsApp
      // (ele exige AAC, AMR, MP3, MP4 ou OGG/Opus) — se a Meta recusar, o erro chega aqui
      res.status(500).json({ error: "A Meta recusou esse áudio: " + e.message + " — tenta gravar de novo ou usa outro navegador." });
    }
  });

  /* humano anexa um arquivo (boleto, comprovante, etc.) e manda como documento */
  app.post("/api/cobranca/chats/:id/send-document", auth, async (req, res) => {
    const chat = db.waChats[req.params.id];
    if (!chat || chat.canal !== "oficial") return res.status(404).json({ error: "Conversa não encontrada" });
    if (req.user.role !== "gerente" && chat.atendenteId !== req.user.id) return res.status(403).json({ error: "Sem acesso a essa conversa" });
    const numeroCfg = acharNumero(chat.numeroOficialId);
    if (!numeroCfg) return res.status(400).json({ error: "Número não encontrado" });
    const b = req.body || {};
    if (!b.arquivoBase64) return res.status(400).json({ error: "Arquivo vazio" });
    if (!b.filename) return res.status(400).json({ error: "Falta o nome do arquivo" });
    try {
      const buffer = Buffer.from(b.arquivoBase64, "base64");
      const mimetype = b.mimetype || "application/octet-stream";
      const ehImagem = /^image\//.test(mimetype);
      const tipoWpp = ehImagem ? "image" : "document";
      const mediaId = await uploadMidiaMeta(numeroCfg, buffer, mimetype, b.filename);
      await enviarMidiaOficial(numeroCfg, chat.numero, tipoWpp, mediaId, b.legenda || "", b.filename);
      const arquivo = salvarMidiaLocal(buffer, mimetype, "humano");
      const ts = Date.now();
      chat.mensagens.push({ role: "me", content: b.legenda || (ehImagem ? "📷 Foto" : "📄 " + b.filename), ts, tipo: tipoWpp, arquivo, mimetype, filename: b.filename });
      chat.atualizadoEm = ts;
      salvar();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "A Meta recusou esse arquivo: " + e.message });
    }
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

  /* exclui uma conversa (mensagens, acordo vinculado etc.) — só gerente, ação irreversível */
  app.delete("/api/cobranca/chats/:id", auth, gerenteOnly, (req, res) => {
    const chat = db.waChats[req.params.id];
    if (!chat || chat.canal !== "oficial") return res.status(404).json({ error: "Conversa não encontrada" });
    delete db.waChats[req.params.id];
    // acordos que apontavam pra essa conversa ficam órfãos de propósito — mantém o histórico
    // financeiro (parcelas, pagamentos já feitos) mesmo que a conversa em si seja apagada
    salvar();
    res.json({ ok: true });
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
    // checagem de sanidade — pega typo de data (ex.: digitar 2023 sem querer) antes de virar acordo de verdade
    const diasDif = Math.round((new Date(b.vencimento + "T00:00:00-03:00") - new Date()) / 86400000);
    if (diasDif < -3 || diasDif > 730) {
      return res.status(400).json({ error: `Essa data de vencimento (${b.vencimento}) está ${diasDif < 0 ? "no passado" : "muito distante"} — confere se não foi digitada errada antes de salvar.` });
    }
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

    // ---- camada 2: dívida ORIGINAL (antes de qualquer acordo) que passou do vencimento sem
    // resolução — sem isso, quem nunca respondeu (ou ficou no meio da conversa) fica invisível
    // pra sempre, sem ninguém saber que o prazo estourou. Aqui a gente não manda mensagem
    // automática (não temos template certo pra cada estágio), só ESCALA pra um humano decidir.
    const ESTADOS_JA_RESOLVIDOS = ["acordo_fechado", "pago", "perdido"];
    for (const chat of Object.values(db.waChats)) {
      if (!chat || chat.canal !== "oficial") continue;
      if (!chat.divida || !chat.divida.vencimento) continue;
      if (ESTADOS_JA_RESOLVIDOS.includes(chat.estadoCobranca)) continue;
      if (chat.vencimentoEstourado) continue; // só escala uma vez, não fica repetindo
      const diasAtraso = diasDeAtraso(chat.divida.vencimento);
      const carencia = cfg.diasCarenciaContatoInicial !== undefined ? cfg.diasCarenciaContatoInicial : 5;
      if (diasAtraso !== null && diasAtraso > carencia) {
        chat.vencimentoEstourado = true;
        atribuirAtendente(chat);
        chat.naoLidas = (chat.naoLidas || 0) + 1;
        chat.atualizadoEm = Date.now();
        if (!Array.isArray(chat.notas)) chat.notas = [];
        const situacao = chat.estadoCobranca === "nao_contatado" ? "nunca respondeu ao disparo"
          : chat.estadoCobranca === "negociando" ? "estava negociando mas não fechou"
          : "não avançou na conversa";
        chat.notas.push({ tipo: "vencimento_estourado", texto: `O vencimento original (${fmtDataBR(chat.divida.vencimento)}) passou há ${diasAtraso} dias e o aluno ${situacao} — atendimento escalado pra revisão humana`, ts: Date.now(), por: "Automação" });
        salvar();
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
                const baixado = await baixarMidiaMeta(numeroCfg, mediaIdMeta, midiaFilename);
                if (baixado) {
                  midiaArquivo = baixado.arquivo; midiaMime = baixado.mimetype;
                  if (midiaTipo === "audio") transcricao = await transcreverAudio(baixado.buffer, baixado.mimetype);
                } else {
                  console.log("[cobranca] não consegui baixar mídia do webhook — tipo:", midiaTipo, "mediaId:", mediaIdMeta);
                }
              } catch (e) { console.log("[cobranca] erro no download de mídia do webhook:", e.message); }
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

            checarAlertaPalavraChave(chat, numeroCfg, content).catch((e) => console.error("[cobranca] erro no alerta:", e.message));

            const temIA = chat.iaId && !chat.iaPausada;
            console.log(`[cobranca] webhook: mensagem recebida no chat ${chat.id} — chat.iaId=${chat.iaId || "(nenhuma)"} iaPausada=${!!chat.iaPausada} → ${temIA ? "chamando rodarIA" : "sem IA, vai pro humano"}`);
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
  /* exporta todas as mensagens de todas as conversas dentro de um período — uma linha por
     mensagem, pra analisar externamente (Excel, ChatGPT, etc.) ou arquivar */
  app.get("/api/cobranca/exportar-conversas", auth, gerenteOnly, (req, res) => {
    garantirEstrutura();
    const inicio = req.query.inicio ? new Date(req.query.inicio + "T00:00:00-03:00").getTime() : 0;
    const fim = req.query.fim ? new Date(req.query.fim + "T23:59:59-03:00").getTime() : Date.now();
    const linhas = [["Data/Hora", "Telefone", "Nome", "Estado", "Status (IA)", "Remetente", "Tipo", "Mensagem"]];
    for (const chat of Object.values(db.waChats)) {
      if (!chat || chat.canal !== "oficial") continue;
      for (const m of chat.mensagens || []) {
        if (m.ts < inicio || m.ts > fim) continue;
        const dataHora = new Date(m.ts).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
        const remetente = m.role === "them" ? "Aluno" : m.porIA ? "IA" : "Atendente";
        const tipo = m.tipo || "texto";
        const texto = (m.transcricao || m.content || "").replace(/"/g, '""').replace(/\n/g, " ");
        linhas.push([dataHora, chat.numero, chat.nome || "", chat.estadoCobranca || "", chat.statusResumo || "", remetente, tipo, texto]);
      }
    }
    const csv = linhas.map((l) => l.map((v) => `"${v}"`).join(",")).join("\n");
    const nomeArquivo = `conversas_${(req.query.inicio || "todas").replace(/-/g, "")}_a_${(req.query.fim || "hoje").replace(/-/g, "")}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${nomeArquivo}"`);
    res.send("\uFEFF" + csv); // BOM pro Excel abrir acentuação certinho
  });

  app.get("/api/cobranca/metricas", auth, gerenteOnly, (req, res) => {
    garantirEstrutura();
    const chats = Object.values(db.waChats).filter((c) => c.canal === "oficial");
    const comDivida = chats.filter((c) => c.divida);
    let totalPendente = 0, totalOriginal = 0;
    const porEstado = { nao_contatado: 0, em_conversa: 0, negociando: 0, acordo_fechado: 0, pago: 0, perdido: 0 };
    for (const c of comDivida) {
      const estado = c.estadoCobranca || "nao_contatado";
      if (porEstado[estado] !== undefined) porEstado[estado]++;
      const somaBoletos = Array.isArray(c.dividas) && c.dividas.length ? c.dividas.reduce((s, d) => s + (Number(d.valor) || 0), 0) : (Number(c.divida.valor) || 0);
      totalOriginal += somaBoletos;
      if (estado !== "pago") totalPendente += somaBoletos;
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
    const vencidosSemAcordo = chats.filter((c) => c.vencimentoEstourado).length;
    res.json({
      totalPendente, totalOriginal, totalRecuperado, porEstado,
      totalContatos: comDivida.length, acordosAtivos, acordosQuebrados,
      parcelasPendentes, parcelasAtrasadas, taxaConversao,
      respondendoIA, aguardandoHumano, vencidosSemAcordo,
      conversasAtivas: chats.filter((c) => !c.encerrado).length,
    });
  });

  /* ============================================================
     VOZ — ligações via ElevenLabs (integração nativa com Twilio).
     A ElevenLabs cuida do áudio/telefonia de verdade — a gente só pede
     pra discar (passando o contexto do aluno) e recebe o resumo depois.
     ============================================================ */
  function vozPublica(v) {
    return {
      elevenAgentId: v.elevenAgentId || "", elevenPhoneNumberId: v.elevenPhoneNumberId || "",
      temElevenKey: !!v.elevenApiKey, ttsVoiceId: v.ttsVoiceId || "",
      ttsEstabilidade: v.ttsEstabilidade !== undefined ? v.ttsEstabilidade : 0.35,
      ttsSimilaridade: v.ttsSimilaridade !== undefined ? v.ttsSimilaridade : 0.85,
      ttsEstilo: v.ttsEstilo !== undefined ? v.ttsEstilo : 0.4,
      companyName: v.companyName || "Escola Instructiva", agentName: v.agentName || "Ana",
      descontoMaxPct: v.descontoMaxPct || 0, origemDebitoPadrao: v.origemDebitoPadrao || "",
      // Twilio: só referência/documentação — quem usa as credenciais é a própria ElevenLabs
      // (importadas lá no dashboard dela), a gente não liga direto pra API do Twilio
      twilioAccountSid: v.twilioAccountSid || "", twilioNumero: v.twilioNumero || "",
      temTwilioToken: !!v.twilioAuthToken,
      webhookToken: v.webhookToken || "",
    };
  }
  app.get("/api/cobranca/voz-config", auth, gerenteOnly, (req, res) => {
    garantirEstrutura();
    if (!db.cobranca.voz) db.cobranca.voz = {};
    if (!db.cobranca.voz.webhookToken) { db.cobranca.voz.webhookToken = "el_" + Math.random().toString(36).slice(2, 12); salvar(); }
    res.json(vozPublica(db.cobranca.voz));
  });
  /* lista as vozes que já estão salvas na conta da ElevenLabs (Minhas Vozes),
     pra escolher num menu em vez de copiar/colar Voice ID na mão */
  app.get("/api/cobranca/eleven-vozes", auth, gerenteOnly, async (req, res) => {
    garantirEstrutura();
    const v = db.cobranca.voz || {};
    if (!v.elevenApiKey) return res.status(400).json({ error: "Configure a API Key da ElevenLabs primeiro" });
    try {
      const r = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": v.elevenApiKey } });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return res.status(400).json({ error: (data.detail && data.detail.message) || "A ElevenLabs recusou a chave" });
      const vozes = (data.voices || []).map((x) => ({ id: x.voice_id, nome: x.name, idioma: (x.labels && (x.labels.language || x.labels.accent)) || "" }));
      res.json({ vozes });
    } catch (e) { res.status(500).json({ error: e.message }); }
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
    if (b.elevenPhoneNumberId !== undefined) v.elevenPhoneNumberId = lim(b.elevenPhoneNumberId, 100);
    if (b.ttsVoiceId !== undefined) v.ttsVoiceId = lim(b.ttsVoiceId, 100);
    if (b.ttsEstabilidade !== undefined) v.ttsEstabilidade = Math.max(0, Math.min(1, Number(b.ttsEstabilidade)));
    if (b.ttsSimilaridade !== undefined) v.ttsSimilaridade = Math.max(0, Math.min(1, Number(b.ttsSimilaridade)));
    if (b.ttsEstilo !== undefined) v.ttsEstilo = Math.max(0, Math.min(1, Number(b.ttsEstilo)));
    if (b.companyName !== undefined) v.companyName = lim(b.companyName, 100);
    if (b.agentName !== undefined) v.agentName = lim(b.agentName, 60);
    if (b.descontoMaxPct !== undefined) v.descontoMaxPct = Math.max(0, Math.min(100, Number(b.descontoMaxPct) || 0));
    if (b.origemDebitoPadrao !== undefined) v.origemDebitoPadrao = lim(b.origemDebitoPadrao, 200);
    salvar();
    res.json(vozPublica(v));
  });

  /* dispara uma ligação de verdade pro aluno dessa conversa */
  app.post("/api/cobranca/chats/:id/ligar", auth, gerenteOnly, async (req, res) => {
    garantirEstrutura();
    const chat = db.waChats[req.params.id];
    if (!chat || chat.canal !== "oficial") return res.status(404).json({ error: "Conversa não encontrada" });
    const v = db.cobranca.voz || {};
    if (!v.elevenApiKey) return res.status(400).json({ error: "Configure a API Key da ElevenLabs em Ligações primeiro" });
    if (!v.elevenAgentId) return res.status(400).json({ error: "Configure o Agent ID da ElevenLabs em Ligações primeiro" });
    if (!v.elevenPhoneNumberId) return res.status(400).json({ error: "Falta o Phone Number ID (o número Twilio precisa estar importado no painel da ElevenLabs primeiro)" });
    try {
      const divida = chat.divida || {};
      const atraso = diasDeAtraso(divida.vencimento);
      // esses nomes precisam bater EXATAMENTE com as variáveis {{...}} usadas no prompt do agente na ElevenLabs
      const dynamic_variables = {
        debtor_name: chat.nome || "",
        valor_formatado: divida.valor ? fmtMoedaBR(divida.valor) : "",
        vencimento_br: divida.vencimento ? fmtDataBR(divida.vencimento) : "",
        dias_atraso: atraso !== null ? String(Math.max(0, atraso)) : "0",
        origem_debito: chat.motivoInadimplencia || v.origemDebitoPadrao || "Mensalidade em atraso",
        company_name: v.companyName || "Escola Instructiva",
        agent_name: v.agentName || "Ana",
        desconto_pct: String(v.descontoMaxPct || 0),
      };
      const r = await fetch("https://api.elevenlabs.io/v1/convai/twilio/outbound-call", {
        method: "POST",
        headers: { "Content-Type": "application/json", "xi-api-key": v.elevenApiKey },
        body: JSON.stringify({
          agent_id: v.elevenAgentId,
          agent_phone_number_id: v.elevenPhoneNumberId,
          to_number: "+" + garantirNonoDigito(normalizaTelefone(chat.numero)),
          conversation_initiation_client_data: { dynamic_variables },
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.success) return res.status(400).json({ error: data.message || "A ElevenLabs recusou a ligação" });
      if (!Array.isArray(chat.notas)) chat.notas = [];
      chat.notas.push({ tipo: "ligacao_iniciada", texto: `${req.user.nome} iniciou uma ligação de voz (IA) pra esse aluno`, ts: Date.now(), por: req.user.nome });
      chat.mensagens.push({ role: "me", content: "📞 Ligação de voz iniciada (IA)", ts: Date.now(), ligacao: true, elevenConversationId: data.conversation_id });
      chat.atualizadoEm = Date.now();
      salvar();
      res.json({ ok: true, conversationId: data.conversation_id, callSid: data.callSid });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /* webhook de pós-ligação da ElevenLabs — recebe o resumo/transcrição quando a ligação termina.
     Configura essa URL + o token (que aparece na tela de Ligações) no painel da ElevenLabs,
     em Settings -> Webhooks -> Post-call. */
  app.post("/api/cobranca/webhook-elevenlabs/:token", async (req, res) => {
    garantirEstrutura();
    if (!db.cobranca.voz || req.params.token !== db.cobranca.voz.webhookToken) return res.status(403).json({ error: "token inválido" });
    res.json({ ok: true }); // confirma recebimento rápido, processa em seguida
    try {
      const b = req.body || {};
      const dados = b.data || b; // formato pode variar, tenta os dois níveis
      const conversationId = dados.conversation_id || dados.conversationId;
      const transcriptResumo = (dados.analysis && dados.analysis.transcript_summary) || dados.summary || "";
      const numeroChamado = (dados.metadata && dados.metadata.phone_call && dados.metadata.phone_call.external_number) || dados.to_number || "";
      // acha a conversa pela nota que guardamos com o elevenConversationId, ou pelo número discado
      let chatAlvo = null;
      for (const c of Object.values(db.waChats)) {
        if (!c || c.canal !== "oficial") continue;
        if ((c.mensagens || []).some((m) => m.elevenConversationId === conversationId)) { chatAlvo = c; break; }
      }
      if (!chatAlvo && numeroChamado) {
        chatAlvo = Object.values(db.waChats).find((c) => c && c.canal === "oficial" && nucleoTelefone(c.numero) === nucleoTelefone(numeroChamado));
      }
      if (chatAlvo) {
        const ts = Date.now();
        chatAlvo.mensagens.push({ role: "me", content: `📞 Ligação encerrada — resumo: ${transcriptResumo || "(sem resumo disponível)"}`, ts, ligacao: true });
        chatAlvo.atualizadoEm = ts;
        chatAlvo.naoLidas = (chatAlvo.naoLidas || 0) + 1;
        if (!Array.isArray(chatAlvo.notas)) chatAlvo.notas = [];
        chatAlvo.notas.push({ tipo: "ligacao_concluida", texto: "Ligação de voz concluída — resumo registrado na conversa", ts, por: "ElevenLabs" });
        salvar();
      }
    } catch (e) {
      console.error("[cobranca] erro no webhook da ElevenLabs:", e.message);
    }
  });

  return { tick };
}

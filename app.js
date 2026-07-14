/* =============================================
   ECOPATH ASSISTANT — APP LOGIC
   Gemini API (multimodal) + Chat UI
   ============================================= */

// ─── Configuration ───────────────────────────────────────────────
const DEFAULT_API_KEY   = "";
const STORAGE_KEY_API   = "ecopath_gemini_key";
const STORAGE_KEY_MODEL = "ecopath_model";
const SESSION_KEY_AUTH  = "ecopath_auth";

// ─── Contraseña de acceso ─────────────────────────────────────────
// Modifica esta cadena para cambiar la contraseña del curso
const ACCESS_PASSWORD = "ecopath2026";

// Modelos de respaldo en orden de prioridad (compatibles con cuentas nuevas)
const FALLBACK_MODELS = [
  "gemini-1.5-flash",
  "gemini-1.5-flash-8b",
  "gemini-2.0-flash",
];

const SYSTEM_PROMPT = `Eres un asistente experto en Ecopath with Ecosim (EwE), el software de modelado de redes tróficas marinas y de aguas continentales. Tu rol es ayudar a investigadores, estudiantes y técnicos pesqueros a construir, balancear e interpretar modelos de Ecopath.

INSTRUCCIONES CLAVE:
- Responde SIEMPRE en español, de forma clara, precisa y didáctica.
- Cuando el usuario envíe una captura de pantalla (imagen) de Ecopath, analiza visualmente lo que ves: errores, advertencias, parámetros, resultados, y proporciona orientación específica.
- Usa términos técnicos de Ecopath correctamente: EE (Eficiencia Ecotrófica), P/B, Q/B, DC (Diet Composition), BA (Biomass Accumulation), TL (Trophic Level), etc.
- Cuando el modelo está desbalanceado (EE > 1), explica causas y soluciones concretas.
- Si el usuario es principiante, guíalo paso a paso sin asumir conocimiento previo.
- Cita valores de referencia bibliográficos cuando sea posible.
- Formatea las respuestas usando Markdown para mayor claridad: listas, tablas, negritas, títulos.
- Cuando des ejemplos de valores típicos, indica las unidades (t·km⁻²·año⁻¹, año⁻¹, etc.)
- Si el usuario sube una imagen de Ecopath, empieza describiendo lo que ves antes de dar recomendaciones.

ÁREAS DE EXPERTISE:
- Construcción de modelos tróficos con Ecopath (grupos funcionales, parámetros, dieta, pesquería)
- Balance de modelos (corrección de EE > 1, ajuste de parámetros)
- Ecosim: simulaciones dinámicas, fitting con datos de series de tiempo, celdas de vulnerabilidad
- Ecospace: distribución espacial, mapas de hábitat, áreas marinas protegidas
- Índice de Pedigree y calidad de datos
- Análisis de redes tróficas (Lindeman spine, ciclos tróficos, keystones)
- Interpretación de resultados y métricas del ecosistema`;

// ─── State ───────────────────────────────────────────────────────
let conversationHistory = [];
let pendingImage = null;  // { base64: string, mimeType: string, previewUrl: string }
let pendingPdf = null;    // { base64: string, mimeType: string, name: string }
let isLoading = false;
let sidebarCollapsed = false;

// ─── DOM References ───────────────────────────────────────────────
const chatArea        = document.getElementById("chatArea");
const messageInput    = document.getElementById("messageInput");
const sendBtn         = document.getElementById("sendBtn");
const statusDot       = document.getElementById("statusDot");
const statusText      = document.getElementById("statusText");
const imagePreviewBar = document.getElementById("imagePreviewBar");
const imageThumb      = document.getElementById("imagePreviewThumb");
const imageLabel      = document.getElementById("imagePreviewLabel");
const apiKeyInput     = document.getElementById("apiKeyInput");
const modelSelect     = document.getElementById("modelSelect");
const settingsPanel   = document.getElementById("settingsPanel");
const sidebar         = document.getElementById("sidebar");
const welcomeScreen   = document.getElementById("welcomeScreen");
const dropZone        = document.getElementById("dropZone");

// PDF Extraction DOM elements
const pdfDropZone        = document.getElementById("pdfDropZone");
const pdfStatusBar       = document.getElementById("pdfStatusBar");
const pdfStatusName      = document.getElementById("pdfStatusName");
const extractBtn         = document.getElementById("extractBtn");
const pdfResultsPanel    = document.getElementById("pdfResultsPanel");
const resultsMeta        = document.getElementById("resultsMeta");
const extractedTableBody = document.getElementById("extractedTableBody");
const extractedTable     = document.getElementById("extractedTable");
const resultsNotes       = document.getElementById("resultsNotes");

// ─── Password Gate ───────────────────────────────────────────────
function checkPassword() {
  const input = document.getElementById("accessPasswordInput").value.trim();
  const errorEl = document.getElementById("accessError");
  const inputWrap = document.getElementById("accessInputWrap");
  const btn = document.getElementById("accessBtn");

  if (input === ACCESS_PASSWORD) {
    // Guardar autenticación en sessionStorage (dura mientras el tab esté abierto)
    sessionStorage.setItem(SESSION_KEY_AUTH, "true");

    // Animación de salida de la tarjeta
    const card = document.getElementById("accessCard");
    card.style.transition = "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)";
    card.style.transform = "scale(0.95) translateY(-20px)";
    card.style.opacity = "0";

    setTimeout(() => {
      const overlay = document.getElementById("accessOverlay");
      overlay.style.transition = "opacity 0.4s ease";
      overlay.style.opacity = "0";
      setTimeout(() => {
        overlay.style.display = "none";
        // Verificar si el estudiante ya tiene su propia API Key guardada
        const savedKey = localStorage.getItem(STORAGE_KEY_API);
        if (!savedKey || savedKey.trim() === "") {
          showApiKeySetupScreen();
        } else {
          init();
        }
      }, 400);
    }, 300);
  } else {
    // Contraseña incorrecta — animar error
    errorEl.classList.remove("hidden");
    inputWrap.classList.add("access-shake");
    document.getElementById("accessPasswordInput").value = "";

    // Efecto de vibración en el botón
    btn.style.background = "linear-gradient(135deg, #c0392b, #e74c3c)";
    setTimeout(() => {
      btn.style.background = "";
      inputWrap.classList.remove("access-shake");
    }, 600);
  }
}

function handleAccessKey(event) {
  if (event.key === "Enter") checkPassword();
  // Ocultar error al escribir
  document.getElementById("accessError").classList.add("hidden");
}

// ─── API Key Setup Screen ─────────────────────────────────────────
function showApiKeySetupScreen() {
  const overlay = document.getElementById("apiKeyOverlay");
  overlay.classList.remove("hidden");
  overlay.style.opacity = "0";
  overlay.style.transition = "opacity 0.4s ease";
  requestAnimationFrame(() => {
    overlay.style.opacity = "1";
  });
  setTimeout(() => {
    const input = document.getElementById("apiKeySetupInput");
    if (input) input.focus();
  }, 500);
}

function saveApiKeyAndEnter() {
  const input = document.getElementById("apiKeySetupInput");
  const errorEl = document.getElementById("apiKeyError");
  const key = input.value.trim();

  if (!key || key.length < 20) {
    errorEl.classList.remove("hidden");
    input.style.borderColor = "rgba(255, 80, 80, 0.5)";
    setTimeout(() => { input.style.borderColor = ""; }, 1500);
    return;
  }

  // Guardar la key en localStorage
  localStorage.setItem(STORAGE_KEY_API, key);
  errorEl.classList.add("hidden");

  // Animación de salida
  const overlay = document.getElementById("apiKeyOverlay");
  const card = document.getElementById("apiKeyCard");
  card.style.transition = "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)";
  card.style.transform = "scale(0.95) translateY(-20px)";
  card.style.opacity = "0";

  setTimeout(() => {
    overlay.style.transition = "opacity 0.4s ease";
    overlay.style.opacity = "0";
    setTimeout(() => {
      overlay.style.display = "none";
      init();
    }, 400);
  }, 300);
}

function handleApiKeySetupKey(event) {
  if (event.key === "Enter") saveApiKeyAndEnter();
  document.getElementById("apiKeyError").classList.add("hidden");
}

// ─── Init ─────────────────────────────────────────────────────────
function init() {
  // Load saved settings
  const savedKey = localStorage.getItem(STORAGE_KEY_API) || DEFAULT_API_KEY;
  const savedModel = localStorage.getItem(STORAGE_KEY_MODEL) || "gemini-1.5-flash";

  apiKeyInput.value = savedKey !== DEFAULT_API_KEY ? savedKey : "";
  modelSelect.value = savedModel;

  // Setup drag & drop on drop zone
  setupDragDrop();
  setupPdfDragDrop();

  // Global paste listener (Ctrl+V anywhere)
  document.addEventListener("paste", handleGlobalPaste);

  // Animate background particles
  createParticles();

  // Resize textarea on load
  autoResize(messageInput);

  console.log("🌊 Ecopath Assistant inicializado");
}

// ─── API Key & Settings ───────────────────────────────────────────
function getApiKey() {
  return localStorage.getItem(STORAGE_KEY_API) || DEFAULT_API_KEY;
}

function getModel() {
  return localStorage.getItem(STORAGE_KEY_MODEL) || "gemini-1.5-flash";
}

function saveApiKey() {
  const key = apiKeyInput.value.trim();
  if (key) {
    localStorage.setItem(STORAGE_KEY_API, key);
    showToast("✅ API Key guardada correctamente");
  } else {
    // Revert to default
    localStorage.removeItem(STORAGE_KEY_API);
    showToast("ℹ️ Usando API Key por defecto");
  }
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEY_MODEL, modelSelect.value);
}

function toggleSettings() {
  settingsPanel.classList.toggle("hidden");
}

// ─── Sidebar ──────────────────────────────────────────────────────
function toggleSidebar() {
  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    sidebar.classList.toggle("mobile-open");
  } else {
    sidebarCollapsed = !sidebarCollapsed;
    sidebar.classList.toggle("collapsed", sidebarCollapsed);
    document.getElementById("sidebarToggle").textContent = sidebarCollapsed ? "›" : "‹";
  }
}

document.getElementById("sidebarToggle").addEventListener("click", toggleSidebar);

// ─── Tab Navigation ───────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll(".nav-tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
  document.getElementById("tab" + capitalize(tab)).classList.add("active");
  document.getElementById("content" + capitalize(tab)).classList.add("active");
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ─── Message Sending ──────────────────────────────────────────────
async function sendMessage() {
  const text = messageInput.value.trim();
  if ((!text && !pendingImage) || isLoading) return;

  // Hide welcome screen
  if (welcomeScreen) welcomeScreen.style.display = "none";

  // Build display message
  const displayText = text || "(imagen adjunta)";
  appendUserMessage(displayText, pendingImage?.previewUrl);

  // Save to history
  const userContent = buildGeminiContent(text, pendingImage);
  conversationHistory.push({ role: "user", parts: userContent });

  // Clear input
  messageInput.value = "";
  autoResize(messageInput);
  clearImagePreview();

  // Show typing indicator
  const typingEl = appendTypingIndicator();

  // Set loading state
  setLoading(true);

  try {
    const responseText = await callGeminiAPI();
    typingEl.remove();
    appendAssistantMessage(responseText);
    conversationHistory.push({ role: "model", parts: [{ text: responseText }] });
  } catch (err) {
    typingEl.remove();
    appendErrorMessage(err.message);
    console.error("Gemini API error:", err);
  } finally {
    setLoading(false);
  }
}

function sendQuickPrompt(prompt) {
  messageInput.value = prompt;
  autoResize(messageInput);

  // On mobile, close sidebar
  if (window.innerWidth <= 768) {
    sidebar.classList.remove("mobile-open");
  }

  sendMessage();
}

// ─── Gemini API Call (con reintentos y modelo de respaldo) ──────────
async function callGeminiAPI() {
  const apiKey = getApiKey();
  const preferredModel = getModel();

  // Construir lista: modelo preferido primero, luego el resto del fallback
  const modelQueue = [
    preferredModel,
    ...FALLBACK_MODELS.filter(m => m !== preferredModel)
  ];

  let lastError = null;

  for (const model of modelQueue) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        statusText.textContent = attempt > 1
          ? `Reintentando con ${model}...`
          : (model !== preferredModel ? `Usando ${model}...` : "Pensando...");

        const result = await callGeminiModel(apiKey, model);
        // Éxito — guardamos el modelo que funcionó si es diferente al preferido
        if (model !== preferredModel) {
          showToast(`✅ Respondió usando ${model}`);
        }
        return result;
      } catch (err) {
        lastError = err;
        const isHighDemand = err.message.includes("high demand") || err.message.includes("503") || err.message.includes("overloaded");
        const isRateLimit  = err.message.includes("429") || err.message.includes("RESOURCE_EXHAUSTED");

        if ((isHighDemand || isRateLimit) && attempt === 1) {
          // Esperar antes de reintentar
          statusText.textContent = `Esperando... (${model})`;
          await sleep(1500);
          continue; // retry same model
        }
        break; // pasar al siguiente modelo
      }
    }
  }

  throw lastError;
}

async function callGeminiModel(apiKey, model) {

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // Build request payload with full conversation history
  const contents = conversationHistory.map(msg => ({
    role: msg.role,
    parts: msg.parts
  }));

  const payload = {
    system_instruction: {
      parts: [{ text: SYSTEM_PROMPT }]
    },
    contents: contents,
    generationConfig: {
      temperature: 0.7,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 8192,
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT",        threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_HATE_SPEECH",       threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
    ]
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    const errMsg = errData?.error?.message || `Error HTTP ${response.status}`;
    throw new Error(`Error de la API de Gemini: ${errMsg}`);
  }

  const data = await response.json();

  // Extract text from response
  const candidates = data?.candidates;
  if (!candidates || candidates.length === 0) {
    throw new Error("La IA no generó ninguna respuesta. Intenta de nuevo.");
  }

  const candidate = candidates[0];
  if (candidate.finishReason === "SAFETY") {
    throw new Error("La respuesta fue bloqueada por filtros de seguridad.");
  }

  const parts = candidate?.content?.parts;
  if (!parts || parts.length === 0) {
    throw new Error("Respuesta vacía del modelo.");
  }

  return parts.map(p => p.text || "").join("");
}

// Utilidad: espera N milisegundos
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Content Builder ─────────────────────────────────────────────
function buildGeminiContent(text, imageData) {
  const parts = [];
  if (imageData) {
    parts.push({
      inline_data: {
        mime_type: imageData.mimeType,
        data: imageData.base64
      }
    });
  }
  if (text) {
    parts.push({ text: text });
  }
  return parts;
}

// ─── Chat UI ──────────────────────────────────────────────────────
function appendUserMessage(text, imageUrl) {
  const time = getTime();
  const el = document.createElement("div");
  el.className = "message user";
  el.innerHTML = `
    <div class="message-avatar">👤</div>
    <div class="message-content">
      <div class="message-bubble">
        ${imageUrl ? `<img src="${imageUrl}" alt="Captura de pantalla" />` : ""}
        ${text && text !== "(imagen adjunta)" ? `<p>${escapeHtml(text)}</p>` : ""}
      </div>
      <div class="message-time">${time}</div>
    </div>
  `;
  chatArea.appendChild(el);
  scrollToBottom();
}

function appendAssistantMessage(markdown) {
  const time = getTime();
  const el = document.createElement("div");
  el.className = "message assistant";
  el.innerHTML = `
    <div class="message-avatar">🌊</div>
    <div class="message-content">
      <div class="message-bubble">${parseMarkdown(markdown)}</div>
      <div class="message-time">${time}</div>
    </div>
  `;
  chatArea.appendChild(el);
  scrollToBottom();
}

function appendErrorMessage(errMsg) {
  const el = document.createElement("div");
  el.className = "message assistant";
  el.innerHTML = `
    <div class="message-avatar">⚠️</div>
    <div class="message-content">
      <div class="message-bubble" style="border-color: rgba(255,100,100,0.3); color: #ff8888;">
        <strong>Error:</strong> ${escapeHtml(errMsg)}
        <br><br>
        <small>Verifica que tu API Key de Gemini sea correcta en ⚙️ Configuración.</small>
      </div>
    </div>
  `;
  chatArea.appendChild(el);
  scrollToBottom();
}

function appendTypingIndicator() {
  const el = document.createElement("div");
  el.className = "message assistant";
  el.id = "typingIndicator";
  el.innerHTML = `
    <div class="message-avatar">🌊</div>
    <div class="message-content">
      <div class="message-bubble" style="padding: 12px 16px;">
        <div class="typing-indicator">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
      </div>
    </div>
  `;
  chatArea.appendChild(el);
  scrollToBottom();
  return el;
}

// ─── Markdown Parser ─────────────────────────────────────────────
function parseMarkdown(text) {
  let html = escapeHtml(text);

  // Code blocks (before inline)
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
    `<pre><code>${code.trim()}</code></pre>`
  );

  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Headers
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

  // Bold + Italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Horizontal rule
  html = html.replace(/^---$/gm, "<hr>");

  // Blockquote
  html = html.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");

  // Tables
  html = parseMarkdownTables(html);

  // Unordered lists
  html = html.replace(/^(\s*[-*+] .+(\n|$))+/gm, (match) => {
    const items = match.trim().split("\n").map(l =>
      l.replace(/^\s*[-*+] /, "")
    );
    return `<ul>${items.map(i => `<li>${i}</li>`).join("")}</ul>`;
  });

  // Ordered lists
  html = html.replace(/^(\s*\d+\. .+(\n|$))+/gm, (match) => {
    const items = match.trim().split("\n").map(l =>
      l.replace(/^\s*\d+\. /, "")
    );
    return `<ol>${items.map(i => `<li>${i}</li>`).join("")}</ol>`;
  });

  // Paragraphs (double newlines)
  html = html.replace(/\n\n+/g, "</p><p>");
  html = "<p>" + html + "</p>";

  // Single newlines to <br> (but not inside block elements)
  html = html.replace(/(?<!<\/(?:ul|ol|li|pre|blockquote|h[1-6]|hr|p)>)\n(?!<(?:ul|ol|li|pre|blockquote|h[1-6]|hr|p))/g, "<br>");

  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, "");
  html = html.replace(/<p>(<(?:ul|ol|pre|blockquote|h[1-6]|hr))/g, "$1");
  html = html.replace(/((?:<\/(?:ul|ol|pre|blockquote|h[1-6]|hr)>))<\/p>/g, "$1");

  return html;
}

function parseMarkdownTables(html) {
  return html.replace(/((?:\|.+\|\n?)+)/g, (match) => {
    const rows = match.trim().split("\n").filter(r => r.trim());
    if (rows.length < 2) return match;

    const headerCells = rows[0].split("|").filter(c => c.trim());
    const isAlignRow = rows[1] && /^[\s|:-]+$/.test(rows[1]);
    const dataRows = isAlignRow ? rows.slice(2) : rows.slice(1);

    if (headerCells.length === 0) return match;

    let table = "<table><thead><tr>";
    headerCells.forEach(c => { table += `<th>${c.trim()}</th>`; });
    table += "</tr></thead><tbody>";

    dataRows.forEach(row => {
      const cells = row.split("|").filter(c => c.trim() !== undefined && c !== "");
      if (cells.length === 0) return;
      table += "<tr>";
      cells.forEach(c => { table += `<td>${c.trim()}</td>`; });
      table += "</tr>";
    });

    table += "</tbody></table>";
    return table;
  });
}

// ─── Image Handling ───────────────────────────────────────────────
function handleFileUpload(event) {
  const file = event.target.files[0];
  if (file && file.type.startsWith("image/")) {
    loadImageFile(file);
  }
  // Reset input so same file can be re-selected
  event.target.value = "";
}

async function pasteFromClipboard() {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      for (const type of item.types) {
        if (type.startsWith("image/")) {
          const blob = await item.getType(type);
          loadImageFile(blob, type);
          return;
        }
      }
    }
    showToast("⚠️ No hay imagen en el portapapeles. Usa Ctrl+PrtSc para capturar.");
  } catch (err) {
    showToast("📌 Pega la imagen directamente aquí con Ctrl+V");
  }
}

function handleGlobalPaste(event) {
  const items = event.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      event.preventDefault();
      const blob = item.getAsFile();
      loadImageFile(blob, item.type);
      return;
    }
  }
}

function loadImageFile(file, forceMimeType) {
  const mimeType = forceMimeType || file.type || "image/png";
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    // Extract base64 (remove data:image/...;base64, prefix)
    const base64 = dataUrl.split(",")[1];
    pendingImage = { base64, mimeType, previewUrl: dataUrl };
    showImagePreview(dataUrl, file.name || "captura.png");
    messageInput.focus();
  };
  reader.readAsDataURL(file);
}

function showImagePreview(src, name) {
  imageThumb.src = src;
  imageLabel.textContent = `📷 ${name} — lista para enviar`;
  imagePreviewBar.classList.remove("hidden");
}

function removeImage() {
  pendingImage = null;
  clearImagePreview();
}

function clearImagePreview() {
  pendingImage = null;
  imagePreviewBar.classList.add("hidden");
  imageThumb.src = "";
}

// ─── Drag & Drop ──────────────────────────────────────────────────
function setupDragDrop() {
  const zone = document.querySelector(".main-content");

  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  });

  zone.addEventListener("dragleave", (e) => {
    if (!zone.contains(e.relatedTarget)) {
      dropZone.classList.remove("drag-over");
    }
  });

  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      loadImageFile(file);
    } else {
      showToast("⚠️ Solo se admiten archivos de imagen");
    }
  });
}

// ─── PDF Drag & Drop & Upload ─────────────────────────────────────
function setupPdfDragDrop() {
  if (!pdfDropZone) return;

  pdfDropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    pdfDropZone.classList.add("drag-over");
  });

  pdfDropZone.addEventListener("dragleave", (e) => {
    pdfDropZone.classList.remove("drag-over");
  });

  pdfDropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    pdfDropZone.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file && file.type === "application/pdf") {
      loadPdfFile(file);
    } else {
      showToast("⚠️ Solo se admiten archivos PDF");
    }
  });
}

function handlePdfUpload(event) {
  const file = event.target.files[0];
  if (file && file.type === "application/pdf") {
    loadPdfFile(file);
  } else {
    showToast("⚠️ Selecciona un archivo PDF válido");
  }
  event.target.value = "";
}

function loadPdfFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    const base64 = dataUrl.split(",")[1];
    
    pendingPdf = {
      base64: base64,
      mimeType: "application/pdf",
      name: file.name
    };

    // Update UI
    pdfStatusName.textContent = file.name;
    pdfStatusBar.classList.remove("hidden");
    pdfDropZone.classList.add("hidden");
    extractBtn.disabled = false;
    showToast("📄 PDF cargado correctamente");
  };
  reader.readAsDataURL(file);
}

function removePdf() {
  pendingPdf = null;
  pdfStatusBar.classList.add("hidden");
  pdfDropZone.classList.remove("hidden");
  extractBtn.disabled = true;
  pdfResultsPanel.classList.add("hidden");
  showToast("🗑️ PDF eliminado");
}

// ─── Extraction Logic ─────────────────────────────────────────────
async function extractParamsFromPdf() {
  if (!pendingPdf || isLoading) return;

  // Determine checkboxes checked
  const extParams = [];
  if (document.getElementById("extB").checked) extParams.push("Biomass (B)");
  if (document.getElementById("extPB").checked) extParams.push("Production/Biomass (P/B)");
  if (document.getElementById("extQB").checked) extParams.push("Consumption/Biomass (Q/B)");
  if (document.getElementById("extEE").checked) extParams.push("Ecotrophic Efficiency (EE)");
  if (document.getElementById("extTL").checked) extParams.push("Trophic Level (TL)");
  if (document.getElementById("extGE").checked) extParams.push("Production/Consumption (P/Q or GE)");
  if (document.getElementById("extDC").checked) extParams.push("Diet Composition (DC)");

  if (extParams.length === 0) {
    showToast("⚠️ Selecciona al menos un parámetro a extraer");
    return;
  }

  setLoading(true);
  statusText.textContent = "Analizando PDF...";
  pdfResultsPanel.classList.add("hidden");

  const prompt = `Analiza el artículo PDF adjunto y extrae todos los parámetros de Ecopath disponibles para los grupos funcionales o especies de peces, invertebrados, mamíferos, detritos, etc., mencionados en el artículo.
Los parámetros requeridos específicamente son: ${extParams.join(", ")}.

Devuelve la información estructurada estrictamente en formato JSON utilizando el siguiente esquema exacto de campos:
{
  "title": "Título del artículo científico",
  "ecosystem": "Ecosistema o región geográfica estudiada",
  "year": "Año del estudio o período de los datos",
  "groups": [
    {
      "name": "Nombre científico o común del grupo trófico",
      "B": "Valor de Biomasa (o '—' si no existe)",
      "PB": "Valor de P/B (o '—')",
      "QB": "Valor de Q/B (o '—')",
      "EE": "Valor de EE (o '—')",
      "TL": "Valor de Nivel Trófico (TL) (o '—')",
      "PQ": "Valor de P/Q (GE) (o '—')",
      "DC": "Breves notas o porcentaje principal de su dieta, o '—'",
      "source": "Sección del artículo, tabla o página de donde proviene el dato"
    }
  ],
  "notes": "Notas metodológicas importantes sobre cómo se obtuvieron los valores o advertencias de calidad de datos"
}

Asegúrate de que:
1. Extraigas información en ambos idiomas (si el artículo está en inglés, traduce los nombres de los grupos/especies al español para que sean legibles en la tabla de Ecopath, pero menciona el nombre original o científico si aplica).
2. Si un parámetro no se menciona para un grupo, pon "—".
3. Responde ÚNICAMENTE con el objeto JSON válido. No incluyas explicaciones adicionales antes ni después del bloque JSON, ni uses etiquetas markdown de código adicionales fuera de las necesarias.`;

  try {
    const apiKey = getApiKey();
    const preferredModel = getModel();

    // Intentaremos primero con el modelo elegido, y si da 429, usaremos el modelo ligero de respaldo
    const modelsToTry = [preferredModel, "gemini-1.5-flash-8b", "gemini-1.5-flash"];
    let lastError = null;
    let responseText = null;

    for (const currentModel of modelsToTry) {
      try {
        statusText.textContent = `Analizando PDF (${currentModel})...`;
        
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;

        // We build the parts with the pdf file
        const parts = [
          {
            inline_data: {
              mime_type: pendingPdf.mimeType,
              data: pendingPdf.base64
            }
          },
          { text: prompt }
        ];

        // Request payload
        const payload = {
          contents: [{ role: "user", parts: parts }],
          generationConfig: {
            temperature: 0.1, // low temperature for precise extraction
            responseMimeType: "application/json"
          }
        };

        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          throw new Error(`HTTP Error ${response.status}`);
        }

        const data = await response.json();
        const candidate = data?.candidates?.[0];
        responseText = candidate?.content?.parts?.[0]?.text;
        
        if (responseText) {
          // Si funcionó, rompemos el ciclo de reintentos de modelos
          break;
        }
      } catch (err) {
        lastError = err;
        console.warn(`Falló extracción con ${currentModel}:`, err.message);
        
        // Si el error es 429 o de cuota, esperamos 2 segundos y probamos el siguiente modelo
        if (err.message.includes("429") || err.message.includes("limit")) {
          statusText.textContent = "Límite excedido. Esperando reintento...";
          await sleep(2000);
        } else {
          // Si es otro error (ej. Key inválida), no tiene sentido probar otros modelos
          throw err;
        }
      }
    }

    if (!responseText) {
      throw lastError || new Error("No se pudo obtener respuesta de la API.");
    }

    // Parse extracted JSON
    let parsedData;
    try {
      parsedData = JSON.parse(responseText.trim());
    } catch (parseErr) {
      // Fallback if there is markdown wrapper
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No se pudo parsear el resultado de la extracción como JSON.");
      }
    }

    displayExtractedResults(parsedData);
    showToast("✅ Extracción completada");
  } catch (err) {
    showToast("❌ Error al extraer parámetros");
    console.error("PDF Extraction error:", err);
    
    // Fallback: Notify in chat area too if it's too severe
    appendErrorMessage("Error extrayendo del PDF: " + err.message + ". Intenta nuevamente en un minuto para que se restablezca tu cuota gratuita.");
  } finally {
    setLoading(false);
  }
}

function displayExtractedResults(data) {
  // Meta details
  resultsMeta.innerHTML = `
    <strong>Artículo:</strong> ${escapeHtml(data.title || pendingPdf.name)}<br>
    <strong>Ecosistema:</strong> ${escapeHtml(data.ecosystem || "No especificado")}<br>
    <strong>Año/Período:</strong> ${escapeHtml(data.year || "No especificado")}
  `;

  // Build headers dynamic based on selections
  const showB = document.getElementById("extB").checked;
  const showPB = document.getElementById("extPB").checked;
  const showQB = document.getElementById("extQB").checked;
  const showEE = document.getElementById("extEE").checked;
  const showTL = document.getElementById("extTL").checked;
  const showGE = document.getElementById("extGE").checked;
  const showDC = document.getElementById("extDC").checked;

  let headHtml = "<tr><th>Grupo / Especie</th>";
  if (showB) headHtml += "<th>B</th>";
  if (showPB) headHtml += "<th>P/B</th>";
  if (showQB) headHtml += "<th>Q/B</th>";
  if (showEE) headHtml += "<th>EE</th>";
  if (showTL) headHtml += "<th>TL</th>";
  if (showGE) headHtml += "<th>P/Q</th>";
  if (showDC) headHtml += "<th>Dieta</th>";
  headHtml += "<th>Fuente</th></tr>";

  extractedTable.querySelector("thead").innerHTML = headHtml;

  // Build rows
  let bodyHtml = "";
  if (data.groups && data.groups.length > 0) {
    data.groups.forEach(g => {
      bodyHtml += `<tr><td><strong>${escapeHtml(g.name)}</strong></td>`;
      if (showB) bodyHtml += `<td>${escapeHtml(g.B || "—")}</td>`;
      if (showPB) bodyHtml += `<td>${escapeHtml(g.PB || "—")}</td>`;
      if (showQB) bodyHtml += `<td>${escapeHtml(g.QB || "—")}</td>`;
      if (showEE) bodyHtml += `<td>${escapeHtml(g.EE || "—")}</td>`;
      if (showTL) bodyHtml += `<td>${escapeHtml(g.TL || "—")}</td>`;
      if (showGE) bodyHtml += `<td>${escapeHtml(g.PQ || "—")}</td>`;
      if (showDC) bodyHtml += `<td title="${escapeHtml(g.DC || '')}">${escapeHtml(g.DC || "—")}</td>`;
      bodyHtml += `<td><small class="text-muted">${escapeHtml(g.source || "—")}</small></td></tr>`;
    });
  } else {
    bodyHtml = `<tr><td colspan="10" style="text-align:center">No se encontraron grupos o parámetros válidos en el documento.</td></tr>`;
  }

  extractedTableBody.innerHTML = bodyHtml;

  // Notes
  resultsNotes.innerHTML = `
    <strong>Notas de extracción:</strong><br>
    ${escapeHtml(data.notes || "Ninguna nota proporcionada por el extractor.")}
  `;

  pdfResultsPanel.classList.remove("hidden");

  // Also append a nice message in chat to notify user
  appendAssistantMessage(`He analizado el PDF **"${escapeHtml(pendingPdf.name)}"** y he extraído los parámetros tróficos requeridos. Puedes revisar y descargar la tabla completa en el panel lateral de **Extraer PDF**.`);
}

function exportPdfTableToCSV() {
  if (!extractedTable) return;
  
  let csv = [];
  const rows = extractedTable.querySelectorAll("tr");
  
  for (let i = 0; i < rows.length; i++) {
    const row = [], cols = rows[i].querySelectorAll("td, th");
    
    for (let j = 0; j < cols.length; j++) {
      // Escape double quotes
      let text = cols[j].textContent.replace(/"/g, '""').trim();
      row.push('"' + text + '"');
    }
    
    csv.push(row.join(","));
  }
  
  const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + csv.join("\n");
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `ecopath_parametros_${pendingPdf ? pendingPdf.name.replace(/\.pdf$/i, '') : 'extract'}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast("📥 CSV descargado");
}

// ─── UI Helpers ───────────────────────────────────────────────────
function handleKeyDown(event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
}

function autoResize(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 180) + "px";
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    chatArea.scrollTop = chatArea.scrollHeight;
  });
}

function setLoading(loading) {
  isLoading = loading;
  sendBtn.disabled = loading;
  messageInput.disabled = loading;

  if (loading) {
    statusDot.classList.add("thinking");
    statusText.textContent = "Pensando...";
  } else {
    statusDot.classList.remove("thinking");
    statusText.textContent = "Listo";
  }
}

function clearChat() {
  conversationHistory = [];
  chatArea.innerHTML = `
    <div class="welcome-screen" id="welcomeScreen">
      <div class="welcome-icon">🌊</div>
      <h2>Hola, soy tu asistente de Ecopath</h2>
      <p>Puedo ayudarte a construir y balancear tu modelo trófico paso a paso.<br>
      Escríbeme una pregunta, sube una captura de pantalla o usa el panel izquierdo para guiarte.</p>
      <div class="welcome-suggestions">
        <button class="suggestion-chip" onclick="sendQuickPrompt('¿Por dónde empiezo a construir un modelo en Ecopath? Soy principiante.')">
          🐣 Soy principiante, ¿por dónde empiezo?
        </button>
        <button class="suggestion-chip" onclick="sendQuickPrompt('¿Cuáles son los datos mínimos que necesito para construir un modelo Ecopath?')">
          📋 ¿Qué datos necesito tener?
        </button>
        <button class="suggestion-chip" onclick="sendQuickPrompt('Explícame la ecuación de balance de Ecopath de forma sencilla')">
          ⚖️ ¿Cómo funciona el balance?
        </button>
      </div>
    </div>
  `;
  clearImagePreview();
  showToast("🗑️ Conversación reiniciada");
}

function resetChecklist() {
  document.querySelectorAll(".checklist input[type=checkbox]").forEach(cb => {
    cb.checked = false;
  });
}

function getTime() {
  return new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(text) {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
  return text.replace(/[&<>"']/g, m => map[m]);
}

function showToast(message) {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed; bottom: 100px; left: 50%; transform: translateX(-50%);
    background: rgba(10, 30, 55, 0.95); backdrop-filter: blur(20px);
    border: 1px solid rgba(0,212,170,0.4); color: #e2f0f9;
    padding: 10px 20px; border-radius: 50px; font-size: 13px;
    z-index: 9999; animation: slideDown 0.3s ease;
    box-shadow: 0 4px 20px rgba(0,0,0,0.4);
  `;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.3s";
    setTimeout(() => toast.remove(), 300);
  }, 2800);
}

// ─── Background Particles ─────────────────────────────────────────
function createParticles() {
  const container = document.getElementById("bgParticles");
  const count = 20;

  for (let i = 0; i < count; i++) {
    const p = document.createElement("div");
    p.className = "particle";
    const size = Math.random() * 4 + 2;
    const left = Math.random() * 100;
    const duration = Math.random() * 20 + 15;
    const delay = Math.random() * 15;
    const opacity = Math.random() * 0.3 + 0.05;

    p.style.cssText = `
      width: ${size}px; height: ${size}px;
      left: ${left}%;
      animation-duration: ${duration}s;
      animation-delay: -${delay}s;
      opacity: ${opacity};
    `;
    container.appendChild(p);
  }
}

// ─── Keyboard Shortcuts ───────────────────────────────────────────
document.addEventListener("keydown", (e) => {
  // Ctrl+K to focus input
  if (e.ctrlKey && e.key === "k") {
    e.preventDefault();
    messageInput.focus();
  }
  // Escape to close settings
  if (e.key === "Escape") {
    settingsPanel.classList.add("hidden");
    sidebar.classList.remove("mobile-open");
  }
});

// ─── Bootstrap ────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // Crear partículas del fondo del login
  const loginContainer = document.getElementById("bgParticlesLogin");
  if (loginContainer) {
    for (let i = 0; i < 15; i++) {
      const p = document.createElement("div");
      p.className = "particle";
      const size = Math.random() * 4 + 2;
      p.style.cssText = `
        width: ${size}px; height: ${size}px;
        left: ${Math.random() * 100}%;
        animation-duration: ${Math.random() * 20 + 15}s;
        animation-delay: -${Math.random() * 15}s;
        opacity: ${Math.random() * 0.3 + 0.05};
      `;
      loginContainer.appendChild(p);
    }
  }

  // Verificar si ya está autenticado en esta sesión
  if (sessionStorage.getItem(SESSION_KEY_AUTH) === "true") {
    const overlay = document.getElementById("accessOverlay");
    if (overlay) overlay.style.display = "none";
    // Verificar si el estudiante ya tiene su propia API Key guardada
    const savedKey = localStorage.getItem(STORAGE_KEY_API);
    if (!savedKey || savedKey.trim() === "") {
      showApiKeySetupScreen();
    } else {
      init();
    }
  } else {
    // Enfocar el campo de contraseña automáticamente
    setTimeout(() => {
      const pwInput = document.getElementById("accessPasswordInput");
      if (pwInput) pwInput.focus();
    }, 400);
  }
});

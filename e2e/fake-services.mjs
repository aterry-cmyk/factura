// Stands in for Anthropic, Resend and Twilio during browser tests, so the app runs its real code
// paths against them. Only the test config points the app here; production has no fake mode.
import http from "node:http";

const calls = [];
let azureFails = false;
let stripeReady = false; // tests flip this through /_stripe: has the business finished Stripe's sign-up? // tests flip this through /_azure to check the fallback to the device's voice
const port = Number(process.env.FAKE_PORT || 3199);

function answerFor(text) {
  const request = /<request>\n([\s\S]*?)\n<\/request>/.exec(text)?.[1] ?? "";
  const isEstimate = /presupuesto|estimado|cotizaci|estimate/i.test(request);
  const items = [];
  if (/cocina/i.test(request)) items.push({ description: "Pintar la cocina", quantity: 1, unit_price: 2200, price_source: "said" });
  if (/ventanas/i.test(request))
    // Only says "3" when the request did: the app refuses a description with a number nobody said.
    items.push({ description: /3 ventanas/i.test(request) ? "Cambiar 3 ventanas" : "Cambio de ventanas", quantity: 1, unit_price: 1450, price_source: "suggested", basis: "Típico para 3 ventanas de vinilo estándar, instaladas." });
  // A door asks follow-up questions first; with <answers> it writes the line from them.
  let questions = [];
  if (/puerta/i.test(request)) {
    const answers = /<answers>\n([\s\S]*?)\n<\/answers>/.exec(text)?.[1] ?? "";
    const said = (q) => new RegExp(`${q}[^\n]*→ (.+)`).exec(answers)?.[1]?.trim();
    if (!answers) {
      questions = [
        { question: "¿Cuántas puertas?", options: ["1", "2", "3"] },
        { question: "¿De qué tipo?", options: ["Entrada", "Interior", "Corrediza"] },
        { question: "¿Incluye retiro de la vieja?", options: ["Sí", "No"] },
      ];
      items.push({ description: "Cambio de puerta", quantity: 1, unit_price: 900, price_source: "said" });
    } else {
      const count = said("Cuántas");
      const type = said("tipo");
      const removal = said("retiro");
      const d = ["Instalación de", count ? `${count} puerta${count === "1" ? "" : "s"}` : "puerta", type ? `de ${type.toLowerCase()}` : ""]
        .filter(Boolean).join(" ") + (removal === "Sí" ? ", con retiro y desecho de la puerta vieja" : "");
      items.push({ description: d, quantity: 1, unit_price: 900, price_source: "said" });
    }
  }
  if (!items.length) items.push({ description: "Trabajo", quantity: 1, unit_price: 100, price_source: "said" });
  return {
    kind: isEstimate ? "estimate" : "invoice",
    customer_name: /juan/i.test(request) ? "Juan" : /ana/i.test(request) ? "Ana" : "",
    items,
    notes: "",
    questions,
  };
}

http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const send = (status, json) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(json));
      };
      if (req.url === "/_calls") return send(200, calls);
      if (req.url?.startsWith("/_stripe")) {
        stripeReady = req.url.includes("ready=1");
        return send(200, { stripeReady });
      }
      if (req.url?.startsWith("/_azure")) {
        azureFails = req.url.includes("fail=1");
        return send(200, { azureFails });
      }
      calls.push({ url: req.url, body });
      if (req.url?.startsWith("/v1/messages")) {
        const params = JSON.parse(body);
        // Photos: a real (bigger) photo reads as a contractor's notes; a tiny blank one has nothing written.
        if (params.tools?.[0]?.name === "record_reading") {
          const image = params.messages[0].content.find((b) => b.type === "image");
          const readable = (image?.source?.data?.length ?? 0) > 3000;
          return send(200, {
            id: "msg_fake", type: "message", role: "assistant", model: params.model, stop_reason: "tool_use", stop_sequence: null,
            usage: { input_tokens: 900, output_tokens: 40 },
            content: [{ type: "tool_use", id: "toolu_fake", name: "record_reading", input: readable
              ? { readable: true, text: "Estimado para Juan\nPintar cocina 2200\nCambiar 3 ventanas", kind_hint: "estimate" }
              : { readable: false, text: "", kind_hint: "unknown" } }],
          });
        }
        // The estimator: a kitchen photo, and the products in its preview.
        if (params.tools?.[0]?.name === "record_space") {
          return send(200, {
            id: "msg_fake", type: "message", role: "assistant", model: params.model, stop_reason: "tool_use", stop_sequence: null,
            usage: { input_tokens: 800, output_tokens: 60 },
            content: [{ type: "tool_use", id: "toolu_fake", name: "record_space", input: {
              is_home: true, space: "kitchen", summary: "Una cocina con gabinetes de roble y encimeras de laminado.", condition: "worn",
              observations: ["Gabinetes de roble gastados", "Encimeras de laminado"],
              suggestions: [{ trade: "kitchen", reason: "Gabinetes y encimeras viejos", priority: "high" }, { trade: "roofing", reason: "no aplica", priority: "high" }, { trade: "flooring", reason: "Piso rayado", priority: "low" }],
            } }],
          });
        }
        if (params.tools?.[0]?.name === "record_products") {
          return send(200, {
            id: "msg_fake", type: "message", role: "assistant", model: params.model, stop_reason: "tool_use", stop_sequence: null,
            usage: { input_tokens: 700, output_tokens: 80 },
            content: [{ type: "tool_use", id: "toolu_fake", name: "record_products", input: {
              products: [
                { category: "Gabinetes", name: "Gabinetes tipo shaker", details: "Azul marino", search: "navy shaker cabinets" },
                { category: "Encimeras", name: "Encimera de cuarzo", details: "Blanca", search: "white quartz countertop" },
                { category: "Grifo", name: "Grifo de cocina", details: "Negro mate", search: "matte black kitchen faucet" },
              ],
              notes: ["Confirmar las medidas de la isla."],
            } }],
          });
        }
        // The planner: a short plan for any job, shares adding up to 100.
        if (params.tools?.[0]?.name === "plan_project") {
          return send(200, {
            id: "msg_fake", type: "message", role: "assistant", model: params.model, stop_reason: "tool_use", stop_sequence: null,
            usage: { input_tokens: 500, output_tokens: 120 },
            content: [{ type: "tool_use", id: "toolu_fake", name: "plan_project", input: { milestones: [
              { name: "Anticipo", share_percent: 20, steps: ["Fecha de inicio acordada"] },
              { name: "Preparación y pintura", share_percent: 50, steps: ["Proteger pisos y muebles", "Resanar paredes", "Dos manos de pintura"] },
              { name: "Entrega", share_percent: 30, steps: ["Limpieza", "Recorrido final con el cliente"] },
            ] } }],
          });
        }
        const text = String(params.messages[0].content);
        return send(200, {
          id: "msg_fake", type: "message", role: "assistant", model: params.model, stop_reason: "tool_use", stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 10 },
          content: [{ type: "tool_use", id: "toolu_fake", name: "record_request", input: answerFor(text) }],
        });
      }
      // fal.ai: example pictures and the preview.
      if (req.url?.startsWith("/fal-ai/")) return send(200, { images: [{ url: `https://v3b.fal.media/files/fake/${req.url.split("/")[2]}.jpg` }] });
      if (req.url === "/cognitiveservices/v1") {
        if (azureFails) return send(401, { error: "bad key" });
        // Not real audio: the tests record what the page asks to play rather than hearing it.
        res.writeHead(200, { "Content-Type": "audio/mpeg" });
        return res.end(Buffer.from("ID3-fake-mp3"));
      }
      // Stripe: accounts, onboarding links, dashboard links and payment pages.
      if (req.url === "/v1/accounts" && req.method === "POST") return send(200, { id: "acct_fake123", charges_enabled: false, details_submitted: false });
      if (req.url?.startsWith("/v1/accounts/") && req.url.endsWith("/login_links")) return send(200, { url: "https://connect.stripe.test/express/acct_fake123" });
      if (req.url?.startsWith("/v1/accounts/")) return send(200, { id: "acct_fake123", charges_enabled: stripeReady, details_submitted: stripeReady });
      if (req.url === "/v1/account_links") return send(200, { url: "https://connect.stripe.test/setup/acct_fake123" });
      if (req.url === "/v1/checkout/sessions") {
        const p = new URLSearchParams(body);
        return send(200, {
          id: "cs_test_fake", url: "https://checkout.stripe.test/pay/cs_test_fake", payment_status: "unpaid", payment_intent: null,
          amount_total: Number(p.get("line_items[0][price_data][unit_amount]")), metadata: {},
        });
      }
      if (req.url === "/emails") return send(200, { id: "email_fake" });
      if (req.url?.includes("/Messages.json")) return send(201, { sid: "SM_fake" });
      send(404, { error: "unknown" });
    });
  })
  .listen(port, () => console.log(`fake services on ${port}`));

// Stands in for Anthropic, Resend and Twilio during browser tests, so the app runs its real code
// paths against them. Only the test config points the app here; production has no fake mode.
import http from "node:http";

const calls = [];
const port = Number(process.env.FAKE_PORT || 3199);

function answerFor(text) {
  const request = /<request>\n([\s\S]*?)\n<\/request>/.exec(text)?.[1] ?? "";
  const isEstimate = /presupuesto|estimate/i.test(request);
  const items = [];
  if (/cocina/i.test(request)) items.push({ description: "Pintar la cocina", quantity: 1, unit_price: 2200, price_source: "said" });
  if (/ventanas/i.test(request))
    items.push({ description: "Cambiar 3 ventanas", quantity: 1, unit_price: 1450, price_source: "suggested", basis: "Típico para 3 ventanas de vinilo estándar, instaladas." });
  if (!items.length) items.push({ description: "Trabajo", quantity: 1, unit_price: 100, price_source: "said" });
  return {
    kind: isEstimate ? "estimate" : "invoice",
    customer_name: /juan/i.test(request) ? "Juan" : "",
    items,
    notes: "",
    questions: [],
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
      calls.push({ url: req.url, body });
      if (req.url?.startsWith("/v1/messages")) {
        const params = JSON.parse(body);
        const text = String(params.messages[0].content);
        return send(200, {
          id: "msg_fake", type: "message", role: "assistant", model: params.model, stop_reason: "tool_use", stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 10 },
          content: [{ type: "tool_use", id: "toolu_fake", name: "record_request", input: answerFor(text) }],
        });
      }
      if (req.url === "/emails") return send(200, { id: "email_fake" });
      if (req.url?.includes("/Messages.json")) return send(201, { sid: "SM_fake" });
      send(404, { error: "unknown" });
    });
  })
  .listen(port, () => console.log(`fake services on ${port}`));

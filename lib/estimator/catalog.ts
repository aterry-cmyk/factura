// The estimator's design vocabulary. Every word sent to an image model comes from here, picked by
// id: the owner and his customer choose options, they never type a prompt.
import type { L, Space } from "./pricebook";

export interface DesignOpt { v: string; label: L; phrase: string }
export interface DesignQ { id: string; label: L; opts: DesignOpt[]; /** Projects that make this question apply ("*": any). */ needs: string[] }

const l = (en: string, es: string): L => ({ en, es });
const o = (v: string, en: string, es: string, phrase: string): DesignOpt => ({ v, label: l(en, es), phrase });

export const SPACES: Record<Space, { label: L; trades: string[]; ask: L }> = {
  exterior: { label: l("Front of the house", "Frente de la casa"), trades: ["roofing", "siding", "windows", "painting", "deck"], ask: l("Update the outside of the house?", "¿Renovar el exterior de la casa?") },
  kitchen: { label: l("Kitchen", "Cocina"), trades: ["kitchen", "flooring", "painting", "electrical", "plumbing"], ask: l("Remodel this kitchen?", "¿Remodelar esta cocina?") },
  bathroom: { label: l("Bathroom", "Baño"), trades: ["bathroom", "flooring", "plumbing", "electrical"], ask: l("Remodel this bathroom?", "¿Remodelar este baño?") },
  basement: { label: l("Basement", "Sótano"), trades: ["basement", "flooring", "electrical", "plumbing"], ask: l("Finish this basement?", "¿Terminar este sótano?") },
  room: { label: l("Another room", "Otro cuarto"), trades: ["flooring", "painting", "electrical", "windows"], ask: l("Update this room?", "¿Renovar este cuarto?") },
};
export const spaceIds = Object.keys(SPACES) as Space[];

export const DESIGN: Record<Space, DesignQ[]> = {
  kitchen: [
    { id: "style", label: l("Style", "Estilo"), needs: ["kitchen"], opts: [
      o("modern", "Modern", "Moderno", "clean modern kitchen with flat-panel cabinets and minimal hardware"),
      o("transitional", "Warm transitional", "Transicional cálido", "warm transitional kitchen with shaker cabinets and natural wood accents"),
      o("classic", "Classic white", "Blanco clásico", "classic white kitchen with shaker cabinets and timeless details"),
      o("farmhouse", "Modern farmhouse", "Rústico moderno", "modern farmhouse kitchen with a farmhouse sink, open shelving and warm wood"),
      o("bold", "Bold color", "Color atrevido", "bold kitchen with deep colored cabinets and statement lighting")] },
    { id: "cabinets", label: l("Cabinet color", "Color de gabinetes"), needs: ["kitchen"], opts: [
      o("white", "White", "Blanco", "bright white painted cabinets"), o("greige", "Greige", "Gris cálido", "soft greige painted cabinets"),
      o("oak", "Natural wood", "Madera natural", "natural light oak wood cabinets"), o("navy", "Navy", "Azul marino", "navy blue painted cabinets"),
      o("sage", "Sage green", "Verde salvia", "sage green painted cabinets"), o("black", "Black", "Negro", "matte black cabinets")] },
    { id: "counters", label: l("Countertops", "Encimeras"), needs: ["kitchen"], opts: [
      o("quartz", "White quartz", "Cuarzo blanco", "solid white quartz countertops"),
      o("marble", "Marble-look quartz", "Cuarzo tipo mármol", "white marble-look quartz countertops with soft gray veining"),
      o("granite", "Dark granite", "Granito oscuro", "dark granite countertops"),
      o("butcher", "Butcher block", "Madera (butcher block)", "warm butcher block wood countertops")] },
    { id: "backsplash", label: l("Backsplash", "Salpicadero"), needs: ["kitchen"], opts: [
      o("subway", "White subway tile", "Azulejo blanco tipo metro", "white subway tile backsplash"),
      o("zellige", "Handmade zellige", "Zellige artesanal", "glossy handmade zellige tile backsplash"),
      o("slab", "Full stone slab", "Losa de piedra completa", "full-height stone slab backsplash"),
      o("pattern", "Patterned tile", "Azulejo con diseño", "patterned ceramic tile backsplash")] },
    { id: "metal", label: l("Hardware and faucet", "Herrajes y grifo"), needs: ["kitchen"], opts: [
      o("black", "Matte black", "Negro mate", "matte black hardware and faucet"), o("brass", "Brushed brass", "Latón cepillado", "brushed brass hardware and faucet"),
      o("nickel", "Brushed nickel", "Níquel cepillado", "brushed nickel hardware and faucet"), o("stainless", "Stainless steel", "Acero inoxidable", "stainless steel hardware and faucet")] },
  ],
  bathroom: [
    { id: "style", label: l("Style", "Estilo"), needs: ["bathroom"], opts: [
      o("spa", "Modern spa", "Spa moderno", "calm modern spa bathroom"), o("transitional", "Warm transitional", "Transicional cálido", "warm transitional bathroom with wood tones"),
      o("classic", "Classic white", "Blanco clásico", "classic white bathroom with timeless details"), o("bold", "Bold color", "Color atrevido", "bold bathroom with colored tile and a statement mirror")] },
    { id: "tile", label: l("Tile", "Azulejo"), needs: ["bathroom"], opts: [
      o("porcelain", "Large porcelain", "Porcelanato grande", "large-format light porcelain wall tile"), o("marble", "Marble look", "Tipo mármol", "white marble-look tile"),
      o("zellige", "Handmade zellige", "Zellige artesanal", "glossy handmade zellige wall tile"), o("pattern", "Patterned floor", "Piso con diseño", "patterned encaustic-look floor tile")] },
    { id: "vanity", label: l("Vanity", "Mueble de lavamanos"), needs: ["bathroom"], opts: [
      o("white", "White", "Blanco", "white shaker vanity"), o("wood", "Natural wood", "Madera natural", "natural wood vanity"),
      o("color", "Navy or green", "Azul o verde", "deep navy painted vanity"), o("floating", "Floating", "Flotante", "wall-mounted floating vanity")] },
    { id: "metal", label: l("Fixture finish", "Acabado de grifería"), needs: ["bathroom"], opts: [
      o("black", "Matte black", "Negro mate", "matte black fixtures"), o("brass", "Brushed brass", "Latón cepillado", "brushed brass fixtures"), o("chrome", "Polished chrome", "Cromo pulido", "polished chrome fixtures")] },
  ],
  basement: [
    { id: "use", label: l("How it will be used", "Para qué se usará"), needs: ["basement"], opts: [
      o("family", "Family room", "Sala familiar", "cozy finished basement family room with a sectional sofa"), o("theater", "Home theater", "Cine en casa", "finished basement home theater with a large screen"),
      o("play", "Playroom", "Cuarto de juegos", "bright finished basement playroom with storage"), o("office", "Gym or office", "Gimnasio u oficina", "finished basement home office and gym area")] },
    { id: "floor", label: l("Floor", "Piso"), needs: ["basement", "flooring"], opts: [
      o("light", "Light plank", "Tablón claro", "light oak-look luxury vinyl plank floor"), o("dark", "Dark plank", "Tablón oscuro", "dark walnut-look luxury vinyl plank floor"), o("carpet", "Carpet", "Alfombra", "soft neutral carpet")] },
  ],
  room: [
    { id: "walls", label: l("Wall color", "Color de paredes"), needs: ["painting"], opts: [
      o("white", "Warm white", "Blanco cálido", "warm white walls"), o("greige", "Greige", "Gris cálido", "soft greige walls"),
      o("sage", "Sage green", "Verde salvia", "muted sage green walls"), o("navy", "Navy accent wall", "Pared de acento azul", "one navy blue accent wall with white walls")] },
    { id: "floor", label: l("Floor", "Piso"), needs: ["flooring"], opts: [
      o("light", "Light oak", "Roble claro", "light oak plank floor"), o("mid", "Mid-tone wood", "Madera media", "mid-tone natural wood floor"), o("dark", "Dark walnut", "Nogal oscuro", "dark walnut wood floor")] },
  ],
  exterior: [
    { id: "siding", label: l("Siding color", "Color del revestimiento"), needs: ["siding", "painting"], opts: [
      o("white", "White", "Blanco", "crisp white siding"), o("gray", "Light gray", "Gris claro", "light gray siding"), o("greige", "Greige", "Gris cálido", "warm greige siding"),
      o("blue", "Blue", "Azul", "muted blue siding"), o("sage", "Sage green", "Verde salvia", "sage green siding"), o("charcoal", "Charcoal", "Gris carbón", "dark charcoal siding")] },
    { id: "trim", label: l("Trim color", "Color de molduras"), needs: ["siding", "painting", "windows"], opts: [o("white", "White", "Blanco", "white trim"), o("black", "Black", "Negro", "black trim")] },
    { id: "roof", label: l("Roof", "Techo"), needs: ["roofing"], opts: [
      o("charcoal", "Charcoal shingles", "Tejas gris carbón", "charcoal architectural shingle roof"), o("brown", "Weathered brown", "Café envejecido", "weathered wood brown architectural shingle roof"),
      o("black", "Black shingles", "Tejas negras", "black architectural shingle roof"), o("metal", "Standing-seam metal", "Metal de junta alzada", "dark standing-seam metal roof")] },
    { id: "door", label: l("Front door", "Puerta principal"), needs: ["painting"], opts: [
      o("black", "Black", "Negra", "black front door"), o("red", "Red", "Roja", "deep red front door"), o("navy", "Navy", "Azul marino", "navy blue front door"), o("wood", "Natural wood", "Madera natural", "natural stained wood front door")] },
  ],
};

/** How the priced choices look, so the preview matches what was priced. */
export const PRICED_LOOK: Record<string, string> = {
  "kitchen.scope.refresh": "refreshed: cabinets painted, new countertops and backsplash, same layout",
  "kitchen.scope.full": "fully remodeled with new cabinets, countertops, backsplash, sink and lighting",
  "kitchen.scope.high": "high-end remodel with custom cabinetry, premium stone and top finishes",
  "kitchen.layout.wall": "a more open feeling",
  "kitchen.extras.island": "a kitchen island",
  "kitchen.extras.appl": "new stainless steel appliances",
  "kitchen.extras.light": "recessed and under-cabinet lighting",
  "bathroom.scope.refresh": "refreshed with a new vanity, toilet, fixtures and paint, same tile",
  "bathroom.scope.full": "fully remodeled with new tile, tub or shower, vanity and lighting",
  "bathroom.scope.luxury": "luxury remodel with custom tile, frameless glass and premium finishes",
  "bathroom.bathing.walkin": "a tiled walk-in shower instead of the tub",
  "bathroom.bathing.freestanding": "a freestanding soaking tub",
  "bathroom.extras.glass": "a frameless glass shower door",
  "bathroom.extras.double": "a double vanity",
  "bathroom.extras.ceiling": "tile to the ceiling",
  "basement.finish.basic": "finished as a simple living space with drywall, ceiling, flooring and lighting",
  "basement.finish.std": "finished as a polished room with better flooring, trim and more lighting",
  "basement.finish.prem": "finished as a premium space with a wet bar, built-ins and a media wall",
  "flooring.mat.lvp": "luxury vinyl plank flooring", "flooring.mat.eng": "engineered hardwood flooring",
  "flooring.mat.hard": "solid hardwood flooring", "flooring.mat.tile": "tile flooring", "flooring.mat.carpet": "new carpet",
  "roofing.mat.arch": "a new architectural shingle roof", "roofing.mat.prem": "a new designer shingle roof", "roofing.mat.metal": "a new standing-seam metal roof",
  "siding.mat.vinyl": "new vinyl siding", "siding.mat.lp": "new engineered wood lap siding", "siding.mat.fc": "new fiber cement lap siding",
  "deck.mat.pt": "a new pressure-treated wood deck", "deck.mat.comp": "a new composite deck with clean railings",
  "windows.mat.vinyl": "new white vinyl double-hung windows", "windows.mat.prem": "new premium fiberglass windows",
  "painting.where.out": "a freshly painted exterior", "painting.where.both": "a freshly painted exterior",
};

/** Priced questions shown with example pictures (quality and material decisions), and the scene they're pictured in. */
export const PRICED_EXAMPLES: Record<string, Space | "deck"> = {
  "kitchen.scope": "kitchen", "bathroom.scope": "bathroom", "basement.finish": "basement",
  "flooring.mat": "room", "roofing.mat": "exterior", "siding.mat": "exterior", "deck.mat": "deck", "windows.mat": "exterior",
};

const SCENE: Record<Space | "deck", (p: string) => string> = {
  kitchen: (p) => `Professional interior photograph of a residential kitchen, ${p}, realistic, natural daylight, eye-level wide shot, no people, no text, no watermark`,
  bathroom: (p) => `Professional interior photograph of a residential bathroom, ${p}, realistic, natural light, no people, no text, no watermark`,
  basement: (p) => `Professional interior photograph of a finished residential basement, ${p}, realistic, warm lighting, no people, no text, no watermark`,
  room: (p) => `Professional interior photograph of a residential living room, ${p}, realistic, natural light, no people, no text, no watermark`,
  exterior: (p) => `Professional real estate photograph of the front of a two-story suburban American house, ${p}, realistic, sunny day, no people, no text, no watermark`,
  deck: (p) => `Professional photograph of the back yard of a suburban house with ${p}, realistic, sunny day, no people, no text, no watermark`,
};

/** "d:kitchen.style.modern" (a look) or "t:kitchen.scope.full" (a priced choice) → its fixed example prompt, or "" if unknown. */
export function examplePrompt(key: string): string {
  const m = /^([dt]):([a-z]+)\.([a-z]+)\.([a-z0-9]+)$/.exec(String(key));
  if (!m) return "";
  const [, kind, a, q, v] = m;
  if (kind === "d") {
    const opt = DESIGN[a as Space]?.find((x) => x.id === q)?.opts.find((x) => x.v === v);
    return opt ? SCENE[a as Space](opt.phrase) : "";
  }
  const scene = PRICED_EXAMPLES[`${a}.${q}`], phrase = PRICED_LOOK[`${a}.${q}.${v}`];
  return scene && phrase ? SCENE[scene](phrase) : "";
}

/** The remodel prompt for the customer's own photo, built only from catalog phrases. */
export function previewPrompt(space: Space, design: Record<string, string>, priced: string[]): string {
  const looks = (DESIGN[space] ?? []).map((q) => q.opts.find((x) => x.v === design[q.id])?.phrase).filter(Boolean);
  const work = [...new Set(priced.map((k) => PRICED_LOOK[k]).filter(Boolean))];
  const keep = space === "exterior"
    ? "Keep the exact same house: same shape, roofline, window and door positions, driveway, trees, landscaping, sky and camera angle."
    : "Keep the exact same room: same camera angle, walls, ceiling height, windows and doors.";
  const name = space === "exterior" ? "the front of this house" : `this ${SPACES[space].label.en.toLowerCase()}`;
  return [
    `Remodel ${name} as a realistic after photo from a professional contractor.`,
    keep,
    work.length ? `The work: ${work.join("; ")}.` : "",
    looks.length ? `Finishes: ${looks.join("; ")}.` : "",
    "Photorealistic, natural light, finished and clean. No people, no text, no logos, no watermark.",
  ].filter(Boolean).join(" ");
}

/** The look questions that apply to the projects chosen. */
export function designFor(space: Space, trades: string[]): DesignQ[] {
  return (DESIGN[space] ?? []).filter((q) => q.needs.includes("*") || q.needs.some((t) => trades.includes(t)));
}

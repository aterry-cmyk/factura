// The estimator's price book: typical installed ranges (labor and materials, permits and disposal)
// for remodeling work. Every number is a [low, high] range in dollars. These are starting points,
// not the owner's prices: every line the estimator writes is a *suggested* price he confirms.
import type { Lang } from "@/lib/types";

export type Range = [number, number];
export type L = { en: string; es: string };

export interface Opt {
  v: string;
  label: L;
  sub?: L;
  /** Effects: a fixed [low, high], a multiplier, a per-unit rate, or a base price. */
  add?: Range;
  mul?: number;
  rate?: Range;
  base?: Range;
  /** What a rate is multiplied by (sqft, area, rooms, roof, walls). */
  per?: string;
  sqft?: number;
  /** "Final price confirmed at the walkthrough" style note. */
  note?: L;
  when?: (a: Answers) => boolean;
}

export type Question =
  | { id: string; type: "choice"; label: L; opts: Opt[]; when?: (a: Answers) => boolean }
  | { id: string; type: "multi"; label: L; opts: Opt[]; req?: boolean; when?: (a: Answers) => boolean }
  | { id: string; type: "number"; label: L; min: number; max: number; step: number; def: number; unit: L; hint?: L; when?: (a: Answers) => boolean }
  | { id: string; type: "home"; label: L; when?: (a: Answers) => boolean };

export type Answers = Record<string, string | string[] | number | undefined>;
export type Space = "kitchen" | "bathroom" | "basement" | "room" | "exterior";

export interface Trade {
  label: L;
  sub: L;
  /** Which space the preview shows for this work. */
  space?: Space | ((a: Answers) => Space);
  weeks: Range;
  q: Question[];
  price: (a: Answers, P: Pricer) => void;
}

export interface Pricer {
  opt: (id: string) => Opt;
  mul: (r: Range, m: number) => Range;
  rate: (r: Range, n: number) => Range;
  line: (label: L, r: Range, note?: L) => void;
  home: () => { sqft: number; stories: number; storyMul: number };
  roofArea: () => number;
  wallArea: () => number;
  adds: (units?: Record<string, number>, only?: string) => void;
}

const l = (en: string, es: string): L => ({ en, es });
const notHalf = (a: Answers) => a.size !== "half";

export const TRADES: Record<string, Trade> = {
  bathroom: {
    label: l("Bathroom", "Baño"), sub: l("Remodel or update", "Remodelar o renovar"), space: "bathroom", weeks: [2, 5],
    q: [
      { id: "size", type: "choice", label: l("Which bathroom?", "¿Qué baño?"), opts: [
        { v: "half", label: l("Half bath", "Medio baño"), sub: l("Toilet and sink", "Inodoro y lavamanos"), mul: 0.55 },
        { v: "hall", label: l("Hall or guest bath", "Baño de pasillo o visitas"), sub: l("Tub or shower", "Tina o ducha"), mul: 1 },
        { v: "primary", label: l("Primary bath", "Baño principal"), sub: l("Larger, often a double vanity", "Más grande, a menudo doble lavamanos"), mul: 1.45 }] },
      { id: "scope", type: "choice", label: l("How much are we changing?", "¿Cuánto vamos a cambiar?"), opts: [
        { v: "refresh", label: l("Refresh", "Renovar"), sub: l("New vanity, toilet, fixtures, paint", "Mueble, inodoro, grifería y pintura nuevos"), base: [7000, 12000] },
        { v: "full", label: l("Full remodel", "Remodelación completa"), sub: l("New tile, tub or shower, vanity, lighting", "Azulejo, tina o ducha, mueble y luces nuevos"), base: [16000, 28000] },
        { v: "luxury", label: l("Luxury", "De lujo"), sub: l("Custom tile, frameless glass, premium finishes", "Azulejo a medida, vidrio sin marco, acabados premium"), base: [30000, 55000] }] },
      { id: "bathing", type: "choice", label: l("Tub or shower?", "¿Tina o ducha?"), when: notHalf, opts: [
        { v: "keep", label: l("Keep the tub as it is", "Dejar la tina como está"), add: [0, 0] },
        { v: "walkin", label: l("Tub to walk-in shower", "Cambiar tina por ducha abierta"), add: [3500, 6500] },
        { v: "combo", label: l("New tub and shower", "Tina y ducha nuevas"), add: [1500, 3500] },
        { v: "freestanding", label: l("Freestanding tub", "Tina independiente"), add: [3000, 7000] }] },
      { id: "extras", type: "multi", label: l("Anything else?", "¿Algo más?"), opts: [
        { v: "glass", label: l("Frameless glass door", "Puerta de vidrio sin marco"), add: [1500, 3000], when: notHalf },
        { v: "heat", label: l("Heated tile floor", "Piso con calefacción"), add: [1500, 2800] },
        { v: "double", label: l("Double vanity", "Lavamanos doble"), add: [1800, 4000], when: notHalf },
        { v: "move", label: l("Move plumbing / new layout", "Mover plomería / nuevo diseño"), add: [3000, 7000] },
        { v: "ceiling", label: l("Tile to the ceiling", "Azulejo hasta el techo"), add: [1500, 3500], when: notHalf },
        { v: "light", label: l("New fan and lighting", "Extractor y luces nuevas"), add: [600, 1400] }] },
    ],
    price(a, P) { const s = P.opt("size"), sc = P.opt("scope"); P.line(joinL(sc.label, s.label), P.mul(sc.base!, s.mul!)); P.adds(); },
  },
  kitchen: {
    label: l("Kitchen", "Cocina"), sub: l("Full or partial remodel", "Remodelación completa o parcial"), space: "kitchen", weeks: [4, 10],
    q: [
      { id: "size", type: "choice", label: l("How big is the kitchen?", "¿Qué tan grande es la cocina?"), opts: [
        { v: "s", label: l("Small", "Pequeña"), sub: l("Under 120 sq ft", "Menos de 120 pies²"), mul: 0.75, sqft: 100 },
        { v: "m", label: l("Medium", "Mediana"), sub: l("120–200 sq ft", "120–200 pies²"), mul: 1, sqft: 160 },
        { v: "l", label: l("Large", "Grande"), sub: l("Over 200 sq ft", "Más de 200 pies²"), mul: 1.4, sqft: 240 }] },
      { id: "scope", type: "choice", label: l("How much are we changing?", "¿Cuánto vamos a cambiar?"), opts: [
        { v: "refresh", label: l("Refresh", "Renovar"), sub: l("Paint or reface cabinets, new counters and backsplash", "Pintar o forrar gabinetes, encimeras y salpicadero nuevos"), base: [14000, 28000] },
        { v: "full", label: l("Full remodel", "Remodelación completa"), sub: l("New cabinets, counters, backsplash, sink, lighting", "Gabinetes, encimeras, salpicadero, fregadero y luces nuevos"), base: [38000, 70000] },
        { v: "high", label: l("High-end", "De alta gama"), sub: l("Custom cabinets, premium stone, top finishes", "Gabinetes a medida, piedra premium, los mejores acabados"), base: [75000, 130000] }] },
      { id: "layout", type: "choice", label: l("The layout", "La distribución"), opts: [
        { v: "keep", label: l("Keep the layout", "Dejar la distribución"), add: [0, 0] },
        { v: "change", label: l("Move things around", "Mover cosas de lugar"), sub: l("Sink, range or fridge in new spots", "Fregadero, estufa o refrigerador en otro lugar"), add: [8000, 20000] },
        { v: "wall", label: l("Open up a wall", "Abrir una pared"), sub: l("Final price depends on what’s in the wall", "El precio final depende de lo que hay en la pared"), add: [5000, 15000] }] },
      { id: "extras", type: "multi", label: l("Anything else?", "¿Algo más?"), opts: [
        { v: "island", label: l("Add an island", "Agregar una isla"), add: [5000, 12000] },
        { v: "appl", label: l("New appliances", "Electrodomésticos nuevos"), add: [6000, 14000] },
        { v: "floor", label: l("New flooring", "Piso nuevo"), rate: [8, 14], per: "sqft" },
        { v: "light", label: l("Recessed and under-cabinet lights", "Luces empotradas y bajo gabinete"), add: [1500, 3500] },
        { v: "pot", label: l("Pot filler", "Grifo para ollas"), add: [800, 1800] }] },
    ],
    price(a, P) { const s = P.opt("size"), sc = P.opt("scope"); P.line(joinL(sc.label, s.label), P.mul(sc.base!, s.mul!)); P.adds({ sqft: s.sqft ?? 0 }); },
  },
  basement: {
    label: l("Basement", "Sótano"), sub: l("Finish or update", "Terminar o renovar"), space: "basement", weeks: [4, 9],
    q: [
      { id: "area", type: "number", label: l("About how many square feet?", "¿Cuántos pies cuadrados, más o menos?"), min: 200, max: 3000, step: 50, def: 700, unit: l("sq ft", "pies²") },
      { id: "finish", type: "choice", label: l("What kind of space?", "¿Qué tipo de espacio?"), opts: [
        { v: "basic", label: l("Basic living space", "Espacio básico"), sub: l("Walls, ceiling, floor, lights", "Paredes, techo, piso y luces"), rate: [38, 52] },
        { v: "std", label: l("Finished room", "Cuarto terminado"), sub: l("Better floors, trim, more lighting", "Mejor piso, molduras y más luces"), rate: [52, 70] },
        { v: "prem", label: l("Premium", "Premium"), sub: l("Wet bar, built-ins, media wall", "Bar, muebles empotrados, pared para TV"), rate: [70, 95] }] },
      { id: "bath", type: "choice", label: l("Add a bathroom?", "¿Agregar un baño?"), opts: [
        { v: "no", label: l("No bathroom", "Sin baño"), add: [0, 0] },
        { v: "half", label: l("Half bath", "Medio baño"), add: [9000, 15000] },
        { v: "full", label: l("Full bath", "Baño completo"), add: [15000, 26000] }] },
      { id: "extras", type: "multi", label: l("Anything else?", "¿Algo más?"), opts: [
        { v: "egress", label: l("Egress window (needed for a bedroom)", "Ventana de escape (necesaria para un cuarto)"), add: [4000, 7500] },
        { v: "damp", label: l("There’s been water or dampness", "Ha habido agua o humedad"), add: [3000, 9000], note: l("confirmed at the walkthrough", "se confirma en la visita") },
        { v: "entry", label: l("Outside basement entrance", "Entrada exterior al sótano"), add: [9000, 18000] }] },
    ],
    price(a, P) { const f = P.opt("finish"); P.line(joinL(f.label, sqftL(Number(a.area))), P.rate(f.rate!, Number(a.area))); P.adds(); },
  },
  flooring: {
    label: l("Flooring", "Pisos"), sub: l("Plank, wood, tile, carpet", "Vinil, madera, cerámica, alfombra"), space: "room", weeks: [1, 2],
    q: [
      { id: "area", type: "number", label: l("About how many square feet?", "¿Cuántos pies cuadrados, más o menos?"), min: 50, max: 4000, step: 25, def: 500, unit: l("sq ft", "pies²") },
      { id: "mat", type: "choice", label: l("Which floor?", "¿Qué piso?"), opts: [
        { v: "lvp", label: l("Luxury vinyl plank", "Vinil de lujo (LVP)"), sub: l("Waterproof, durable", "Resistente al agua, duradero"), rate: [5, 8.5] },
        { v: "eng", label: l("Engineered hardwood", "Madera de ingeniería"), rate: [8, 13] },
        { v: "hard", label: l("Solid hardwood", "Madera sólida"), rate: [10, 16] },
        { v: "tile", label: l("Tile", "Cerámica o porcelanato"), rate: [12, 22] },
        { v: "carpet", label: l("Carpet", "Alfombra"), rate: [4, 7] }] },
      { id: "extras", type: "multi", label: l("Anything else?", "¿Algo más?"), opts: [
        { v: "remove", label: l("Remove the old floor", "Quitar el piso viejo"), rate: [1.2, 2.5], per: "area" },
        { v: "level", label: l("Level the subfloor", "Nivelar el contrapiso"), rate: [1.5, 3.5], per: "area" },
        { v: "stairs", label: l("Stairs too (about 13 steps)", "También la escalera (unos 13 escalones)"), add: [1600, 3200] }] },
    ],
    price(a, P) { const m = P.opt("mat"); P.line(joinL(m.label, sqftL(Number(a.area))), P.rate(m.rate!, Number(a.area))); P.adds({ area: Number(a.area) }); },
  },
  painting: {
    label: l("Painting", "Pintura"), sub: l("Interior or exterior", "Interior o exterior"), space: (a) => (a.where === "in" ? "room" : "exterior"), weeks: [1, 2],
    q: [
      { id: "where", type: "choice", label: l("Inside or outside?", "¿Adentro o afuera?"), opts: [
        { v: "in", label: l("Interior", "Interior") }, { v: "out", label: l("Exterior", "Exterior") }, { v: "both", label: l("Both", "Ambos") }] },
      { id: "rooms", type: "number", label: l("How many rooms?", "¿Cuántos cuartos?"), min: 1, max: 20, step: 1, def: 4, unit: l("rooms", "cuartos"), when: (a) => a.where !== "out" },
      { id: "inx", type: "multi", label: l("Inside, also paint…", "Adentro, también pintar…"), when: (a) => a.where !== "out", opts: [
        { v: "ceil", label: l("Ceilings", "Techos"), rate: [180, 350], per: "rooms" },
        { v: "trim", label: l("Trim and doors", "Molduras y puertas"), rate: [250, 600], per: "rooms" },
        { v: "repair", label: l("Drywall and ceiling repairs", "Reparar paredes y techo"), add: [300, 1200] }] },
      { id: "home", type: "home", label: l("Size of the house", "Tamaño de la casa"), when: (a) => a.where !== "in" },
    ],
    price(a, P) {
      if (a.where !== "out") { P.line(l(`Interior walls · ${a.rooms} rooms`, `Paredes interiores · ${a.rooms} cuartos`), P.rate([450, 950], Number(a.rooms))); P.adds({ rooms: Number(a.rooms) }, "inx"); }
      if (a.where !== "in") { const h = P.home(); P.line(l(`Exterior · about ${h.sqft.toLocaleString("en-US")} sq ft home`, `Exterior · casa de unos ${h.sqft.toLocaleString("en-US")} pies²`), P.mul(P.rate([2.6, 4.4], h.sqft), h.storyMul)); }
    },
  },
  roofing: {
    label: l("Roof", "Techo"), sub: l("Replace or repair", "Cambiar o reparar"), space: "exterior", weeks: [0.4, 1],
    q: [
      { id: "home", type: "home", label: l("Size of the house", "Tamaño de la casa") },
      { id: "mat", type: "choice", label: l("New roof", "Techo nuevo"), opts: [
        { v: "arch", label: l("Architectural shingles", "Tejas arquitectónicas"), sub: l("The most common choice", "Lo más común"), rate: [5.75, 8.75] },
        { v: "prem", label: l("Designer shingles", "Tejas de diseño"), rate: [7.5, 11] },
        { v: "metal", label: l("Standing-seam metal", "Metal de junta alzada"), rate: [13, 20] },
        { v: "repair", label: l("Just a repair", "Solo una reparación"), add: [450, 2500] }] },
      { id: "pitch", type: "choice", label: l("How steep is it?", "¿Qué tan inclinado es?"), when: (a) => a.mat !== "repair", opts: [
        { v: "low", label: l("Low / walkable", "Bajo / se camina"), mul: 1 }, { v: "normal", label: l("Normal", "Normal"), mul: 1.05 }, { v: "steep", label: l("Steep", "Empinado"), mul: 1.22 }] },
      { id: "extras", type: "multi", label: l("Anything else?", "¿Algo más?"), when: (a) => a.mat !== "repair", opts: [
        { v: "layers", label: l("Two old layers to tear off", "Quitar dos capas viejas"), rate: [0.8, 1.5], per: "roof" },
        { v: "gutters", label: l("New gutters and downspouts", "Canaletas y bajantes nuevas"), add: [1400, 3200] },
        { v: "skylight", label: l("Skylight", "Tragaluz"), add: [1200, 2800] }] },
    ],
    price(a, P) {
      const m = P.opt("mat");
      if (a.mat === "repair") return P.line(l("Roof repair", "Reparación de techo"), m.add!);
      const roof = P.roofArea();
      P.line(joinL(m.label, l(`about ${roof.toLocaleString("en-US")} sq ft of roof`, `unos ${roof.toLocaleString("en-US")} pies² de techo`)), P.mul(P.rate(m.rate!, roof), P.opt("pitch").mul!));
      P.adds({ roof });
    },
  },
  siding: {
    label: l("Siding", "Revestimiento (siding)"), sub: l("Vinyl, fiber cement", "Vinil, fibrocemento"), space: "exterior", weeks: [1, 3],
    q: [
      { id: "home", type: "home", label: l("Size of the house", "Tamaño de la casa") },
      { id: "mat", type: "choice", label: l("Which siding?", "¿Qué revestimiento?"), opts: [
        { v: "vinyl", label: l("Vinyl", "Vinil"), rate: [7, 11.5] },
        { v: "lp", label: l("Engineered wood (LP)", "Madera de ingeniería (LP)"), rate: [9, 14] },
        { v: "fc", label: l("Fiber cement (Hardie)", "Fibrocemento (Hardie)"), rate: [11, 17] }] },
      { id: "extras", type: "multi", label: l("Anything else?", "¿Algo más?"), opts: [
        { v: "wrap", label: l("New house wrap", "Barrera de humedad nueva"), rate: [0.9, 1.6], per: "walls" },
        { v: "trim", label: l("Window and door trim wrap", "Forrar marcos de ventanas y puertas"), add: [1500, 4000] },
        { v: "rot", label: l("Some rotted wood to fix", "Reparar madera podrida"), add: [800, 3500], note: l("confirmed once the old siding is off", "se confirma al quitar el revestimiento viejo") }] },
    ],
    price(a, P) { const m = P.opt("mat"), w = P.wallArea(); P.line(joinL(m.label, l(`about ${w.toLocaleString("en-US")} sq ft of wall`, `unos ${w.toLocaleString("en-US")} pies² de pared`)), P.rate(m.rate!, w)); P.adds({ walls: w }); },
  },
  deck: {
    label: l("Deck", "Terraza (deck)"), sub: l("New or rebuilt", "Nueva o reconstruida"), space: "exterior", weeks: [1, 3],
    q: [
      { id: "area", type: "number", label: l("About how big?", "¿Qué tamaño, más o menos?"), min: 80, max: 1200, step: 10, def: 300, unit: l("sq ft", "pies²"), hint: l("A 12 × 16 ft deck is 192 sq ft.", "Una terraza de 12 × 16 pies son 192 pies².") },
      { id: "mat", type: "choice", label: l("Decking", "Material"), opts: [
        { v: "pt", label: l("Pressure-treated wood", "Madera tratada"), rate: [32, 50] },
        { v: "comp", label: l("Composite (Trex-type)", "Compuesto (tipo Trex)"), rate: [50, 80] }] },
      { id: "extras", type: "multi", label: l("Anything else?", "¿Algo más?"), opts: [
        { v: "demo", label: l("Remove the old deck", "Quitar la terraza vieja"), add: [1500, 3000] },
        { v: "stairs", label: l("Stairs to the yard", "Escalera al patio"), add: [1500, 3500] },
        { v: "rail", label: l("Upgraded railing", "Baranda mejorada"), add: [2000, 5500] },
        { v: "light", label: l("Deck lighting", "Luces en la terraza"), add: [800, 2000] }] },
    ],
    price(a, P) { const m = P.opt("mat"); P.line(joinL(m.label, sqftL(Number(a.area))), P.rate(m.rate!, Number(a.area))); P.adds(); },
  },
  windows: {
    label: l("Windows", "Ventanas"), sub: l("Replacement windows", "Ventanas de reemplazo"), space: "exterior", weeks: [0.5, 1.5],
    q: [
      { id: "count", type: "number", label: l("How many windows?", "¿Cuántas ventanas?"), min: 1, max: 40, step: 1, def: 8, unit: l("windows", "ventanas") },
      { id: "mat", type: "choice", label: l("Which windows?", "¿Qué ventanas?"), opts: [
        { v: "vinyl", label: l("Vinyl double-hung", "Vinil de guillotina doble"), rate: [750, 1300] },
        { v: "prem", label: l("Premium (fiberglass or wood-clad)", "Premium (fibra de vidrio o madera revestida)"), rate: [1300, 2300] }] },
    ],
    price(a, P) { const m = P.opt("mat"); P.line(l(`${a.count} × ${m.label.en.toLowerCase()}`, `${a.count} × ${m.label.es.toLowerCase()}`), P.rate(m.rate!, Number(a.count))); },
  },
  plumbing: {
    label: l("Plumbing", "Plomería"), sub: l("Repairs and fixtures", "Reparaciones y accesorios"), weeks: [0.2, 1],
    q: [{ id: "items", type: "multi", req: true, label: l("What do you need?", "¿Qué necesitas?"), opts: [
      { v: "wh", label: l("Water heater (tank)", "Calentador de agua (tanque)"), add: [1800, 3200] },
      { v: "tankless", label: l("Tankless water heater", "Calentador sin tanque"), add: [3800, 6500] },
      { v: "toilet", label: l("Replace a toilet", "Cambiar un inodoro"), add: [450, 900] },
      { v: "faucet", label: l("Faucet or fixture", "Grifo o accesorio"), add: [250, 600] },
      { v: "disposal", label: l("Garbage disposal", "Triturador de basura"), add: [400, 800] },
      { v: "leak", label: l("Find and fix a leak", "Encontrar y arreglar una fuga"), add: [300, 1200] }] }],
    price(a, P) { P.adds(); },
  },
  electrical: {
    label: l("Electrical", "Electricidad"), sub: l("Lights, panels, upgrades", "Luces, paneles, mejoras"), weeks: [0.2, 1],
    q: [
      { id: "items", type: "multi", req: true, label: l("What do you need?", "¿Qué necesitas?"), opts: [
        { v: "recessed", label: l("Recessed lights", "Luces empotradas"), add: [0, 0] },
        { v: "fan", label: l("Ceiling fan", "Ventilador de techo"), add: [300, 650] },
        { v: "panel", label: l("Panel upgrade (200 amp)", "Cambio de panel (200 amperios)"), add: [2800, 5500] },
        { v: "ev", label: l("EV charger", "Cargador de auto eléctrico"), add: [1200, 2800] },
        { v: "outlets", label: l("Outlets and switches", "Enchufes e interruptores"), add: [450, 1200] }] },
      { id: "cans", type: "number", label: l("How many recessed lights?", "¿Cuántas luces empotradas?"), min: 1, max: 40, step: 1, def: 6, unit: l("lights", "luces"), when: (a) => ((a.items as string[]) || []).includes("recessed") },
    ],
    price(a, P) {
      if (((a.items as string[]) || []).includes("recessed")) P.line(l(`${a.cans} recessed lights`, `${a.cans} luces empotradas`), P.rate([250, 450], Number(a.cans)));
      P.adds();
    },
  },
};

export const HOME = [
  { v: "s", label: l("Under 1,500 sq ft", "Menos de 1,500 pies²"), sqft: 1200 },
  { v: "m", label: l("1,500–2,500 sq ft", "1,500–2,500 pies²"), sqft: 2000 },
  { v: "l", label: l("2,500–3,500 sq ft", "2,500–3,500 pies²"), sqft: 3000 },
  { v: "xl", label: l("Over 3,500 sq ft", "Más de 3,500 pies²"), sqft: 4200 },
];
export const STORIES = [
  { v: "1", label: l("1 story", "1 piso"), mul: 1 },
  { v: "2", label: l("2 stories", "2 pisos"), mul: 1.15 },
  { v: "3", label: l("3 stories", "3 pisos"), mul: 1.35 },
];
/** Labor costs more in some places. Anything not listed counts as 1. */
export const REGION: Record<string, number> = { VA: 1.05, DC: 1.12 };
const ROUND = 250;

function joinL(a: L, b: L): L {
  return { en: `${a.en} · ${b.en.toLowerCase()}`, es: `${a.es} · ${b.es.toLowerCase()}` };
}
function sqftL(n: number): L {
  return l(`${n.toLocaleString("en-US")} sq ft`, `${n.toLocaleString("en-US")} pies²`);
}

export const tradeIds = Object.keys(TRADES);
export const spaceOf = (id: string, a: Answers): Space | undefined => {
  const s = TRADES[id]?.space;
  return typeof s === "function" ? s(a) : s;
};

export interface Home { size: string; stories: string }
export interface PricedLine { label: L; range: Range; note?: L }
export interface PricedTrade { id: string; lines: PricedLine[]; total: Range }

const roundRange = ([lo, hi]: Range): Range => [Math.max(0, Math.floor(lo / ROUND) * ROUND), Math.ceil(hi / ROUND) * ROUND];
const visible = (q: { when?: (a: Answers) => boolean }, a: Answers) => !q.when || q.when(a);

/** True when every question that applies has an answer. */
export function complete(id: string, a: Answers, home: Home): boolean {
  const t = TRADES[id];
  if (!t) return false;
  return t.q.every((q) => {
    if (!visible(q, a)) return true;
    if (q.type === "choice") return typeof a[q.id] === "string" && q.opts.some((o) => o.v === a[q.id]);
    if (q.type === "number") return Number(a[q.id]) > 0;
    if (q.type === "multi") return !q.req || (Array.isArray(a[q.id]) && (a[q.id] as string[]).length > 0);
    return HOME.some((h) => h.v === home.size);
  });
}

/** The answers with every number question set to its default, so a new project starts filled in. */
export function withDefaults(id: string, a: Answers = {}): Answers {
  const out = { ...a };
  for (const q of TRADES[id]?.q ?? []) if (q.type === "number" && !(Number(out[q.id]) > 0)) out[q.id] = q.def;
  return out;
}

/** The lines and total for one project, in dollars, rounded out to $250. */
export function priceTrade(id: string, a: Answers, home: Home, state: string): PricedTrade {
  const t = TRADES[id];
  const lines: PricedLine[] = [];
  const reg = REGION[state] ?? 1;
  const homeInfo = () => {
    const st = STORIES.find((s) => s.v === String(home.stories)) ?? STORIES[1];
    const band = HOME.find((h) => h.v === home.size);
    return { sqft: band ? band.sqft : 2000, stories: Number(st.v), storyMul: st.mul };
  };
  const P: Pricer = {
    opt: (qid) => {
      const q = t.q.find((x) => x.id === qid) as { opts: Opt[] } | undefined;
      const opts = q?.opts ?? [];
      return opts.find((o) => o.v === a[qid]) ?? opts[0];
    },
    mul: (r, m) => [r[0] * m, r[1] * m],
    rate: (r, n) => [r[0] * n, r[1] * n],
    line: (label, r, note) => { lines.push({ label, range: [r[0] * reg, r[1] * reg], note }); },
    home: homeInfo,
    roofArea: () => { const h = homeInfo(); return Math.round(((h.sqft / h.stories) * 1.18) / 10) * 10; },
    wallArea: () => { const h = homeInfo(), f = h.sqft / h.stories; return Math.round((4.4 * Math.sqrt(f) * 9.5 * h.stories * 0.85) / 50) * 50; },
    adds: (units = {}, only) => {
      for (const q of t.q) {
        if (!visible(q, a) || (only && q.id !== only)) continue;
        if (q.type === "choice") {
          const o = q.opts.find((x) => x.v === a[q.id]);
          if (o && o.add && (o.add[0] || o.add[1]) && !o.base && q.id !== "mat") P.line(o.label, o.add, o.note);
        }
        if (q.type === "multi") {
          for (const v of (a[q.id] as string[]) || []) {
            const o = q.opts.find((x) => x.v === v);
            if (!o || (o.when && !o.when(a))) continue;
            if (o.add && (o.add[0] || o.add[1])) P.line(o.label, o.add, o.note);
            if (o.rate) P.line(o.label, P.rate(o.rate, units[o.per ?? ""] ?? 0), o.note);
          }
        }
      }
    },
  };
  t.price(a, P);
  const total = lines.reduce<Range>((s, x) => [s[0] + x.range[0], s[1] + x.range[1]], [0, 0]);
  return { id, lines: lines.map((x) => ({ ...x, range: roundRange(x.range) })), total: roundRange(total) };
}

/** Time on site for several projects: the longest one's shortest time, up to all of them back to back. */
export function weeksFor(ids: string[]): Range {
  return ids.reduce<Range>((s, id) => [Math.max(s[0], TRADES[id].weeks[0]), s[1] + TRADES[id].weeks[1]], [0, 0]);
}

export function weeksText([lo, hi]: Range, lang: Lang): string {
  const one = (w: number) => {
    if (w < 1) { const d = Math.max(1, Math.round(w * 7)); return lang === "es" ? `${d} día${d > 1 ? "s" : ""}` : `${d} day${d > 1 ? "s" : ""}`; }
    const n = Math.round(w);
    return lang === "es" ? `${n} semana${n > 1 ? "s" : ""}` : `${n} week${n > 1 ? "s" : ""}`;
  };
  return `${one(lo)}–${one(hi)}`;
}

/** Each choice the customer made, as "trade.question.option", which the preview uses to show what was priced. */
export function choiceKeys(id: string, a: Answers): string[] {
  return (TRADES[id]?.q ?? []).filter((q) => visible(q, a)).flatMap((q) => {
    const v = a[q.id];
    if (q.type === "choice") return typeof v === "string" ? [`${id}.${q.id}.${v}`] : [];
    if (q.type === "multi") return ((v as string[]) || []).map((x) => `${id}.${q.id}.${x}`);
    return [];
  });
}

/**
 * What a professional invoice usually spells out, trade by trade. The assistant uses it two
 * ways: to word each line in the trade's own terms, and to choose the few follow-up questions a
 * good office manager would ask before the invoice goes out. It is guidance for questions and
 * wording only; every detail that reaches the invoice still has to come from the owner.
 */
export const TRADE_GUIDE: { trade: string; specify: string; terms: string }[] = [
  {
    trade: "Painting",
    specify: "interior or exterior; which rooms or surfaces (walls, ceilings, trim, doors, cabinets, siding, deck, fence); prep (patching, sanding, caulking, priming, pressure washing); number of coats; paint supplied by the contractor or the customer",
    terms: "pintura interior/exterior, preparación de superficies, resanar, imprimación (primer), dos manos de pintura, molduras (trim), cielo raso / interior/exterior painting, surface prep, patch and prime, two coats, trim, ceilings",
  },
  {
    trade: "Windows and doors",
    specify: "how many units; replacement or new installation; type (single-hung, double-hung, sliding, casement, picture; entry, interior, sliding patio, storm door); frame material (vinyl, aluminum, wood, fiberglass); removal and disposal of the old unit; trim, caulking and weather sealing; unit supplied by the contractor or the customer",
    terms: "reemplazo de ventana, ventana de guillotina doble, corrediza, marco de vinilo/aluminio, retiro y desecho de la ventana vieja, sellado y calafateo, instalación de puerta de entrada / window replacement, double-hung, sliding, vinyl frame, removal and disposal of old unit, caulking and sealing, pre-hung door installation",
  },
  {
    trade: "Roofing",
    specify: "repair or full replacement; roofing material (asphalt shingles, metal, tile, flat/TPO); area in squares if he gave it; tear-off of old layers; underlayment, flashing, vents, gutters; dumpster and debris removal",
    terms: "reparación de techo, reemplazo de techo, tejas asfálticas, retiro de capas viejas, membrana (underlayment), tapajuntas (flashing) / roof repair, re-roof, asphalt shingles, tear-off, underlayment, flashing, ridge vent, debris haul-away",
  },
  {
    trade: "Plumbing",
    specify: "what was repaired or installed (faucet, toilet, water heater, drain, pipe, garbage disposal, shower valve); which room; repair or replacement; parts supplied; emergency or after-hours call; drain cleaning method",
    terms: "reparación de fuga, cambio de llave (grifo), instalación de inodoro, calentador de agua, destape de drenaje, tubería / leak repair, faucet replacement, toilet installation, water heater replacement, drain clearing, supply line, shut-off valve",
  },
  {
    trade: "Electrical",
    specify: "what was installed or repaired (outlets, switches, light fixtures, ceiling fan, panel, breaker, circuit, GFCI); how many; new circuit or replacement; permit and inspection if he mentioned them",
    terms: "instalación de tomacorrientes, interruptores, lámpara, ventilador de techo, panel eléctrico, breaker, circuito nuevo, GFCI / outlet installation, switch replacement, light fixture, ceiling fan, panel upgrade, breaker replacement, dedicated circuit",
  },
  {
    trade: "Flooring and tile",
    specify: "material (tile, laminate, vinyl plank/LVP, hardwood, carpet); area or rooms; removal of old flooring; subfloor prep or leveling; baseboards or trim; grout and sealing",
    terms: "instalación de piso laminado, piso vinílico (LVP), loseta/cerámica, retiro del piso viejo, nivelación, zócalos, boquilla / laminate installation, luxury vinyl plank, tile installation, demo of existing flooring, subfloor leveling, baseboards, grout and seal",
  },
  {
    trade: "Drywall and carpentry",
    specify: "repair or new install; where; patch size or number of sheets if he said it; tape, mud and texture match; framing, trim, cabinets, shelving, decks, fences",
    terms: "reparación de tablaroca (drywall), resane, cinta y compuesto, textura, carpintería, marcos, gabinetes, cerca, deck / drywall repair, patch, tape and mud, texture match, framing, trim carpentry, cabinet install, fence, deck",
  },
  {
    trade: "HVAC",
    specify: "service type (maintenance, repair, installation); equipment (AC, furnace, heat pump, mini-split, thermostat, ductwork); what was replaced (capacitor, motor, coil, filter); refrigerant if he said so",
    terms: "mantenimiento de aire acondicionado, reparación de calefacción, instalación de minisplit, termostato, ductos, recarga de refrigerante / AC maintenance, furnace repair, heat pump, mini-split installation, thermostat, ductwork, refrigerant recharge",
  },
  {
    trade: "Concrete and masonry",
    specify: "what (driveway, patio, sidewalk, slab, steps, retaining wall, brick or block); new, repair or replacement; demolition and haul-away; finish (broom, stamped, exposed aggregate); area if he said it",
    terms: "losa de concreto, entrada (driveway), patio, banqueta, demolición y retiro, acabado escobillado/estampado, muro de contención / concrete slab, driveway, patio, sidewalk, demo and haul-away, broom finish, stamped concrete, retaining wall",
  },
  {
    trade: "Landscaping and yard",
    specify: "what (mowing, trimming, edging, leaf cleanup, tree trimming or removal, mulch, sod, irrigation, gutter cleaning); one-time or recurring; debris haul-away",
    terms: "corte de césped, orillado, limpieza de hojas, poda/remoción de árboles, mantillo (mulch), pasto en rollo, riego, limpieza de canaletas / lawn mowing, edging, leaf cleanup, tree trimming, tree removal, mulch installation, sod, irrigation repair, gutter cleaning, debris removal",
  },
  {
    trade: "Cleaning",
    specify: "type (standard, deep, move-in/move-out, post-construction, office); which areas or rooms; one-time or recurring; supplies included",
    terms: "limpieza profunda, limpieza de mudanza, limpieza post-construcción, limpieza de oficina / deep cleaning, move-out cleaning, post-construction cleanup, recurring cleaning service",
  },
  {
    trade: "Handyman and general repairs",
    specify: "each task named on its own line (mounting, assembly, repairs, caulking, small installs); materials supplied or not",
    terms: "servicio de mantenimiento general, instalación de TV, armado de muebles, reparaciones menores / handyman service, TV mounting, furniture assembly, minor repairs",
  },
];

export const TRADES_VERSION = "trades@1";

/** The guide as it is given to the model. */
export function tradeGuideText(): string {
  return TRADE_GUIDE.map((t) => `- ${t.trade}: a professional invoice states ${t.specify}. Usual terms: ${t.terms}.`).join("\n");
}

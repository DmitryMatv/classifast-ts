import { pyStrip } from "../python/str.js";

export interface PopularLookupLink {
  readonly classifierType: string;
  readonly label: string;
  readonly url: string;
}

// Curated anchor text; the sitemap decides which of these pages are
// canonical and server-rendered.
const POPULAR_LOOKUP_CATALOG: ReadonlyMap<
  string,
  readonly (readonly [label: string, path: string])[]
> = new Map(
  Object.entries({
    UNSPSC: [
      ["Laptop computers", "/UNSPSC/laptop_computer/"],
      ["Desktop computers", "/UNSPSC/desktop_computer/"],
      ["Office chairs", "/UNSPSC/office_chair/"],
      ["Office desks", "/UNSPSC/office_desk/"],
      ["Copy paper", "/UNSPSC/copy_paper/"],
      ["Printer toner", "/UNSPSC/printer_toner/"],
      ["Safety gloves", "/UNSPSC/safety_gloves/"],
      ["Industrial pumps", "/UNSPSC/industrial_pump/"],
      ["Centrifugal pumps", "/UNSPSC/centrifugal_pump/"],
      ["Valves", "/UNSPSC/valve/"],
      ["Electric motors", "/UNSPSC/electric_motor/"],
      ["Air compressors", "/UNSPSC/air_compressor/"],
      ["Forklifts", "/UNSPSC/forklift/"],
      ["Generators", "/UNSPSC/generator/"],
      ["Network switches", "/UNSPSC/network_switch/"],
      ["Server racks", "/UNSPSC/server_rack/"],
      ["Laser printers", "/UNSPSC/laser_printer/"],
      ["Tablet computers", "/UNSPSC/tablet_computer/"],
      ["Printers", "/UNSPSC/printer/"],
      ["Ergonomic office chairs", "/UNSPSC/ergonomic_office_chair/"],
    ],
    NAICS: [
      ["Property management", "/NAICS/property_management/"],
      ["Software development", "/NAICS/software_development/"],
      ["Construction", "/NAICS/construction/"],
      ["Restaurants", "/NAICS/restaurant/"],
      ["Accounting services", "/NAICS/accounting/"],
      ["Trucking", "/NAICS/trucking/"],
      ["Real estate", "/NAICS/real_estate/"],
      ["Plumbing contractors", "/NAICS/plumbing/"],
    ],
    HS: [
      ["Smartphones", "/HS/smartphone/"],
      ["Coffee beans", "/HS/coffee_beans/"],
      ["Laptops", "/HS/laptops/"],
      ["Pharmaceuticals", "/HS/pharmaceuticals/"],
      ["Auto parts", "/HS/auto_parts/"],
      ["Furniture", "/HS/furniture/"],
      ["Televisions", "/HS/televisions/"],
      ["Medical devices", "/HS/medical_devices/"],
    ],
    CN: [
      ["Frozen mangoes", "/CN/frozen_mangoes/"],
      ["Olive oil", "/CN/olive_oil/"],
      ["Wine", "/CN/wine/"],
      ["Pharmaceuticals", "/CN/pharmaceuticals/"],
      ["Electric vehicles", "/CN/electric_vehicles/"],
      ["Solar panels", "/CN/solar_panels/"],
      ["Electronics", "/CN/electronics/"],
      ["Medical devices", "/CN/medical_devices/"],
    ],
    HTS: [
      ["Smartphones", "/HTS/smartphone/"],
      ["Hydraulic tools", "/HTS/hydraulic_tools/"],
      ["Auto parts", "/HTS/auto_parts/"],
      ["Steel products", "/HTS/steel_products/"],
      ["Coffee beans", "/HTS/coffee_beans/"],
      ["Electronics", "/HTS/electronics/"],
      ["Footwear", "/HTS/footwear/"],
      ["Medical devices", "/HTS/medical_devices/"],
    ],
    GPC: [
      ["Smartphones", "/GPC/smartphone/"],
      ["Shampoo", "/GPC/shampoo/"],
      ["Coffee", "/GPC/coffee/"],
      ["Laptops", "/GPC/laptop/"],
      ["Toothpaste", "/GPC/toothpaste/"],
      ["Milk", "/GPC/milk/"],
      ["Bread", "/GPC/bread/"],
      ["Televisions", "/GPC/television/"],
    ],
    EMDN: [
      ["Syringes", "/EMDN/syringe/"],
      ["Nebulizers", "/EMDN/nebulizer/"],
      ["Catheters", "/EMDN/catheter/"],
      ["Surgical gloves", "/EMDN/surgical_gloves/"],
      ["Defibrillators", "/EMDN/defibrillator/"],
      ["Ultrasound scanners", "/EMDN/ultrasound_scanner/"],
      ["Stethoscopes", "/EMDN/stethoscope/"],
      ["Wheelchairs", "/EMDN/wheelchair/"],
    ],
    ETIM: [
      ["Circuit breakers", "/ETIM/circuit_breaker/"],
      ["Cables", "/ETIM/cable/"],
      ["LED lamps", "/ETIM/LED_lamp/"],
      ["Switches", "/ETIM/switch/"],
      ["Power supplies", "/ETIM/power_supply/"],
      ["Connectors", "/ETIM/connector/"],
      ["Transformers", "/ETIM/transformer/"],
      ["Fuses", "/ETIM/fuse/"],
    ],
    ISIC: [
      ["Pharmacies", "/ISIC/pharmacy/"],
      ["Forestry", "/ISIC/forestry/"],
      ["Software development", "/ISIC/software_development/"],
      ["Construction", "/ISIC/construction/"],
      ["Retail trade", "/ISIC/retail_trade/"],
      ["Manufacturing", "/ISIC/manufacturing/"],
      ["Education", "/ISIC/education/"],
      ["Financial services", "/ISIC/financial_services/"],
    ],
    NACE: [
      ["Pharmacies", "/NACE/pharmacy/"],
      ["Software development", "/NACE/software_development/"],
      ["Construction", "/NACE/construction/"],
      ["Retail", "/NACE/retail/"],
      ["Used car dealerships", "/NACE/used_car_dealership/"],
      ["Manufacturing", "/NACE/manufacturing/"],
      ["Education", "/NACE/education/"],
      ["Financial services", "/NACE/financial_services/"],
    ],
    CPV: [
      ["Office supplies", "/CPV/office_supplies/"],
      ["IT services", "/CPV/IT_services/"],
      ["Construction works", "/CPV/construction_works/"],
      ["Medical equipment", "/CPV/medical_equipment/"],
      ["Cleaning services", "/CPV/cleaning_services/"],
      ["Vehicles", "/CPV/vehicles/"],
      ["Software development", "/CPV/software_development/"],
      ["Consulting services", "/CPV/consulting_services/"],
    ],
    NSN: [
      ["Batteries", "/NSN/battery/"],
      ["Bolts", "/NSN/bolt/"],
      ["Filters", "/NSN/filter/"],
      ["Hoses", "/NSN/hose/"],
      ["Pumps", "/NSN/pump/"],
      ["Valves", "/NSN/valve/"],
      ["Engines", "/NSN/engine/"],
      ["Generators", "/NSN/generator/"],
    ],
  }),
);

const HOMEPAGE_UNSPSC_LABELS = [
  "Laptop computers",
  "Office chairs",
  "Industrial pumps",
  "Safety gloves",
  "Printers",
  "Network switches",
];

export function getPopularLookupLinks(
  classifierType: string,
  sitemapQueryPaths: ReadonlySet<string>,
): PopularLookupLink[] {
  const upperType = pyStrip(classifierType).toUpperCase();
  return (POPULAR_LOOKUP_CATALOG.get(upperType) ?? [])
    .filter(([, path]) => sitemapQueryPaths.has(path))
    .map(([label, url]) => ({ classifierType: upperType, label, url }));
}

export function getHomepagePopularLookupLinks(
  sitemapQueryPaths: ReadonlySet<string>,
): PopularLookupLink[] {
  const unspscLinks = new Map(
    getPopularLookupLinks("UNSPSC", sitemapQueryPaths).map((link) => [
      link.label,
      link,
    ]),
  );
  return [
    ...HOMEPAGE_UNSPSC_LABELS.flatMap((label) => unspscLinks.get(label) ?? []),
    ...getPopularLookupLinks("HS", sitemapQueryPaths).slice(0, 1),
    ...getPopularLookupLinks("NAICS", sitemapQueryPaths).slice(0, 1),
  ];
}

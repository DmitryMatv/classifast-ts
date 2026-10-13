import type { ReactElement } from "react";

// The sections that address Google indexing for each standard except
// UNSPSC, whose guide is UnspscGuide.
export const CLASSIFIER_GUIDES: Readonly<Record<string, ReactElement>> = {
  ETIM: (
    <section
      id="etim-guide"
      className="bg-white p-6 rounded-lg shadow max-w-5xl mx-auto mt-4"
    >
      <h2 className="text-xl font-bold text-gray-800 mb-4">
        ETIM Technical Classification Guide
      </h2>
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 mb-2">
            ETIM Structure Explained
          </h3>
          <p className="text-gray-600 mb-2">
            ETIM uses alphanumeric class codes with descriptive attributes:
          </p>
          <ul className="text-gray-600 space-y-1">
            <li>
              <strong>Class Code:</strong> Format like EC000123 (Electrical)
            </li>
            <li>
              <strong>Group Structure:</strong> Technical, Electrical, Climate
              control
            </li>
            <li>
              <strong>Attributes:</strong> Technical specs, dimensions,
              materials
            </li>
            <li>
              <strong>Values:</strong> Standardized measurement units
            </li>
          </ul>
        </div>
        <div>
          <h3 className="text-lg font-semibold text-gray-800 mb-2">
            Regional Variations
          </h3>
          <p className="text-gray-600 mb-2">
            Different ETIM standards serve specific markets:
          </p>
          <ul className="text-gray-600 space-y-1">
            <li>
              • <strong>ETIM International:</strong> Global standard (English)
            </li>
            <li>
              • <strong>ETIM Germany:</strong> German market focus
            </li>
            <li>
              • <strong>ETIM US:</strong> North American adaptation
            </li>
            <li>
              • <strong>ETIM Nordic:</strong> Scandinavian markets
            </li>
          </ul>
        </div>
      </div>
      <div className="mt-4">
        <h3 className="text-lg font-semibold text-gray-800 mb-2">
          Technical Product Focus
        </h3>
        <p className="text-gray-600">
          ETIM specializes in technical and electrical products including
          circuit breakers, HVAC systems, lighting fixtures, cables, and
          industrial automation equipment. Each class includes detailed
          technical specifications and performance characteristics.
        </p>
      </div>
    </section>
  ),
  NAICS: (
    <section
      id="naics-guide"
      className="bg-white p-6 rounded-lg shadow max-w-5xl mx-auto mt-4"
    >
      <h2 className="text-xl font-bold text-gray-800 mb-4">
        NAICS Business Classification System
      </h2>
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 mb-2">
            NAICS vs SIC Comparison
          </h3>
          <p className="text-gray-600 mb-2">
            Key differences from the older Standard Industrial Classification:
          </p>
          <ul className="text-gray-600 space-y-1">
            <li>• 6-digit codes vs 4-digit SIC codes</li>
            <li>• Service sector emphasis (vs manufacturing focus)</li>
            <li>• North American trilateral cooperation (US/Canada/Mexico)</li>
            <li>• Updated every 5 years (vs SIC 1987 final update)</li>
            <li>• Better alignment with modern economy</li>
          </ul>
        </div>
        <div>
          <h3 className="text-lg font-semibold text-gray-800 mb-2">
            Government Contracting
          </h3>
          <p className="text-gray-600 mb-2">NAICS codes are essential for:</p>
          <ul className="  text-gray-600 space-y-1">
            <li>• Federal contract opportunities (SAM.gov)</li>
            <li>• Small business size standards determination</li>
            <li>• SBA certification programs (8(a), HUBZone, etc)</li>
            <li>• Statistical reporting and tax purposes</li>
            <li>• Industry benchmarking and analysis</li>
          </ul>
        </div>
      </div>
      <div className="mt-4">
        <h3 className="text-lg font-semibold text-gray-800 mb-2">
          {"Code Structure & Hierarchy"}
        </h3>
        <p className="text-gray-600">
          NAICS uses a hierarchical structure from 2-digit sectors to 6-digit
          national industries. The 2022 revision includes 1170 industries across
          20 sectors, updated every 5 years to reflect economic changes.
        </p>
      </div>
    </section>
  ),
  ISIC: (
    <section
      id="isic-guide"
      className="bg-white p-6 rounded-lg shadow max-w-5xl mx-auto mt-4"
    >
      <h2 className="text-xl font-bold text-gray-800 mb-4">
        ISIC: UN's Global Economic Classification
      </h2>
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 mb-2">
            UN Statistics Division Role
          </h3>
          <p className="text-gray-600 mb-2">
            Developed and maintained by the United Nations Statistics Division:
          </p>
          <ul className="  text-gray-600 space-y-1">
            <li>• Global standard since 1948</li>
            <li>• Used by 200+ countries and territories</li>
            <li>• Foundation for national accounts compilation</li>
            <li>• International comparability standard</li>
            <li>• Regular 10-year revision cycles</li>
          </ul>
        </div>
        <div>
          <h3 className="text-lg font-semibold text-gray-800 mb-2">
            International Comparability
          </h3>
          <p className="text-gray-600 mb-2">
            ISIC enables cross-country economic analysis:
          </p>
          <ul className="  text-gray-600 space-y-1">
            <li>• GDP comparison across nations</li>
            <li>• Employment statistics alignment</li>
            <li>• Trade flow analysis</li>
            <li>• Development indicator measurement</li>
            <li>• Policy impact assessment</li>
          </ul>
        </div>
      </div>
      <div className="mt-4">
        <h3 className="text-lg font-semibold text-gray-800 mb-2">
          ISIC vs NAICS Comparison
        </h3>
        <p className="text-gray-600">
          While ISIC provides global standardization, NAICS offers more detailed
          industry breakdowns for North America. ISIC Rev.4 has 21 sections
          compared to NAICS 20 sectors, with ISIC focusing on international
          comparability versus NAICS regional specificity.
        </p>
      </div>
    </section>
  ),
  HS: (
    <section
      id="hs-guide"
      className="bg-white p-6 rounded-lg shadow max-w-5xl mx-auto mt-4"
    >
      <h2 className="text-xl font-bold text-gray-800 mb-4">
        Harmonized System (HS) Code Guide
      </h2>
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 mb-2">
            {"Customs & Trade Applications"}
          </h3>
          <p className="text-gray-600 mb-2">
            HS codes are essential for international trade:
          </p>
          <ul className="  text-gray-600 space-y-1">
            <li>• Customs duty calculation and tariff schedules</li>
            <li>• Import/export licensing requirements</li>
            <li>• Trade statistics and economic analysis</li>
            <li>• Anti-dumping and safeguard measures</li>
            <li>• Free trade agreement qualification</li>
          </ul>
        </div>
        <div>
          <h3 className="text-lg font-semibold text-gray-800 mb-2">
            Global Implementation
          </h3>
          <p className="text-gray-600 mb-2">
            Used by customs authorities worldwide:
          </p>
          <ul className="  text-gray-600 space-y-1">
            <li>• 200+ countries and territories</li>
            <li>• World Customs Organization (WCO) standard</li>
            <li>• 6-digit base with national extensions</li>
            <li>• Updated every 5-6 years (2022 latest)</li>
            <li>• 5000+ commodity groups</li>
          </ul>
        </div>
      </div>
      <div className="mt-4">
        <h3 className="text-lg font-semibold text-gray-800 mb-2">
          {"Structure & Classification"}
        </h3>
        <p className="text-gray-600">
          HS uses a hierarchical structure: 21 Sections → 99 Chapters → 1,000+
          Headings → 5000+ Subheadings. Each 6-digit code represents a specific
          commodity, with countries adding 2-4 digit national extensions for
          detailed tariff lines.
        </p>
      </div>
    </section>
  ),
  CN: (
    <section
      id="cn-guide"
      className="bg-white p-6 rounded-lg shadow max-w-5xl mx-auto mt-4"
    >
      <h2 className="text-xl font-bold text-gray-800 mb-4">
        Combined Nomenclature (CN) Code Guide
      </h2>
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 mb-2">
            {"EU Customs & Trade Applications"}
          </h3>
          <p className="text-gray-600 mb-2">
            CN codes are essential for European Union trade:
          </p>
          <ul className="text-gray-600 space-y-1">
            <li>• EU customs declarations and tariff schedules</li>
            <li>• Import/export duty calculation within EU</li>
            <li>• Intrastat reporting for intra-EU trade</li>
            <li>• Common Customs Tariff (CCT) compliance</li>
            <li>• TARIC system integration</li>
          </ul>
        </div>
        <div>
          <h3 className="text-lg font-semibold text-gray-800 mb-2">
            {"Structure & Hierarchy"}
          </h3>
          <p className="text-gray-600 mb-2">
            CN extends HS codes with EU-specific details:
          </p>
          <ul className="text-gray-600 space-y-1">
            <li>• 8-digit EU extension of 6-digit HS codes</li>
            <li>• Annual updates aligned with EU trade policy</li>
            <li>
              • Chapter (2 digits), heading (4 digits), subheading (6 digits)
            </li>
            <li>• CN subheadings (8 digits) for EU-specific needs</li>
            <li>• TARIC codes (10 digits) for additional measures</li>
          </ul>
        </div>
      </div>
      <div className="mt-4">
        <h3 className="text-lg font-semibold text-gray-800 mb-2">
          European Union Implementation
        </h3>
        <p className="text-gray-600">
          CN is mandatory for all EU member states and serves as the legal basis
          for customs tariffs and trade statistics across the European Union. It
          provides the common language for customs procedures and ensures
          consistent classification throughout the single market.
        </p>
      </div>
    </section>
  ),
  NACE: (
    <section
      id="nace-guide"
      className="bg-white p-6 rounded-lg shadow max-w-5xl mx-auto mt-4"
    >
      <h2 className="text-xl font-bold text-gray-800 mb-4">
        NACE: EU Economic Activity Classification
      </h2>
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 mb-2">
            EU Statistical Framework
          </h3>
          <p className="text-gray-600 mb-2">
            NACE is the statistical classification of economic activities in the
            EU:
          </p>
          <ul className="text-gray-600 space-y-1">
            <li>• European statistical system foundation</li>
            <li>• National accounts and GDP calculations</li>
            <li>• Business registers and company surveys</li>
            <li>• Employment and labor market statistics</li>
            <li>• Structural business statistics (SBS)</li>
          </ul>
        </div>
        <div>
          <h3 className="text-lg font-semibold text-gray-800 mb-2">
            Harmonized EU Standards
          </h3>
          <p className="text-gray-600 mb-2">
            NACE ensures consistency across EU member states:
          </p>
          <ul className="text-gray-600 space-y-1">
            <li>• Compatible with ISIC Rev.4 international standard</li>
            <li>• 4-level hierarchical structure (21 sections)</li>
            <li>• Regular updates every 5-10 years</li>
            <li>• Multilingual implementation across EU</li>
            <li>• Cross-country economic comparisons</li>
          </ul>
        </div>
      </div>
      <div className="mt-4">
        <h3 className="text-lg font-semibold text-gray-800 mb-2">
          {"Business & Policy Applications"}
        </h3>
        <p className="text-gray-600">
          NACE codes are used by Eurostat, national statistical institutes, and
          EU policymakers for economic analysis, regional development planning,
          and monitoring of economic performance across different sectors and
          regions.
        </p>
      </div>
    </section>
  ),
  CPV: (
    <section
      id="cpv-guide"
      className="bg-white p-6 rounded-lg shadow max-w-5xl mx-auto mt-4"
    >
      <h2 className="text-xl font-bold text-gray-800 mb-4">
        CPV: Common Procurement Vocabulary Guide
      </h2>
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 mb-2">
            EU Public Procurement
          </h3>
          <p className="text-gray-600 mb-2">
            CPV is essential for EU public procurement:
          </p>
          <ul className="text-gray-600 space-y-1">
            <li>• EU public procurement directives</li>
            <li>• TED (Tenders Electronic Daily) system</li>
            <li>• e-Procurement platforms across EU</li>
            <li>• Contract award notices and tender documents</li>
            <li>• Procurement statistics and market analysis</li>
          </ul>
        </div>
        <div>
          <h3 className="text-lg font-semibold text-gray-800 mb-2">
            {"Structure & Classification"}
          </h3>
          <p className="text-gray-600 mb-2">
            CPV provides comprehensive procurement categories:
          </p>
          <ul className="text-gray-600 space-y-1">
            <li>• 9-digit hierarchical code structure</li>
            <li>• Main vocabulary with 45,000+ categories</li>
            <li>• Supplementary vocabulary for specialized needs</li>
            <li>• Divisions, groups, classes, and categories</li>
            <li>• Multilingual EU-wide standardization</li>
          </ul>
        </div>
      </div>
      <div className="mt-4">
        <h3 className="text-lg font-semibold text-gray-800 mb-2">
          {"Transparency & Competition"}
        </h3>
        <p className="text-gray-600">
          CPV enables transparent and competitive public procurement across the
          European Union, facilitating cross-border tendering and ensuring equal
          access to public contracts for all EU businesses.
        </p>
      </div>
    </section>
  ),
  NSN: (
    <section
      id="nsn-guide"
      className="bg-white p-6 rounded-lg shadow max-w-5xl mx-auto mt-4"
    >
      <h2 className="text-xl font-bold text-gray-800 mb-4">
        NSN: NATO Stock Number Classification Guide
      </h2>
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 mb-2">
            {"Structure & Format"}
          </h3>
          <p className="text-gray-600 mb-2">
            NSN uses a standardized 13-digit identification format:
          </p>
          <ul className="text-gray-600 space-y-1">
            <li>
              • <strong>4-digit FSC:</strong> Federal Supply Class (e.g. 1005 -
              Guns, 75mm through 125mm)
            </li>
            <li>
              • <strong>2-digit NCB:</strong> NATO Country Code (e.g. 00-09 for
              USA, 99 for UK)
            </li>
            <li>
              • <strong>7-digit NIIN:</strong> National Item Identification
              Number
            </li>
            <li>
              • <strong>Complete NSN:</strong> 1234-00-123-4567 format
            </li>
            <li>
              • <strong>Unique identification:</strong> Every item has one NSN
              globally
            </li>
          </ul>
        </div>
        <div>
          <h3 className="text-lg font-semibold text-gray-800 mb-2">
            {"NATO & Military Applications"}
          </h3>
          <p className="text-gray-600 mb-2">
            NSN is essential for defense and military logistics:
          </p>
          <ul className="text-gray-600 space-y-1">
            <li>• NATO standardization agreements (STANAGs)</li>
            <li>• Military supply chain management</li>
            <li>• Defense procurement and contracting</li>
            <li>• Allied interoperability programs</li>
            <li>• Weapon systems and equipment tracking</li>
          </ul>
        </div>
      </div>
      <div className="mt-4">
        <h3 className="text-lg font-semibold text-gray-800 mb-2">
          Global Standardization
        </h3>
        <p className="text-gray-600">
          NSN enables seamless logistics across NATO member nations and partner
          countries. The system provides universal identification for over 6
          million items, facilitating joint operations, equipment sharing, and
          multinational defense procurement while maintaining supply chain
          visibility and inventory control.
        </p>
      </div>
    </section>
  ),
};

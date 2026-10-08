import { z } from "zod";

export interface ClassifierVersion {
  readonly collectionName: string;
}

export interface ClassifierConfig {
  readonly embedModelName: string;
  readonly embedDims: number;
  readonly queryInstruction: string;
  readonly rerankInstruction: string;
  readonly versions: Readonly<Record<string, ClassifierVersion>>;
}

export type ClassifierConfigMap = Readonly<Record<string, ClassifierConfig>>;

/** The part of the classifier config that the Qdrant schema checks read. */
export type CollectionLayout = Readonly<
  Record<string, Pick<ClassifierConfig, "embedDims" | "versions">>
>;

const DEFAULT_QUERY_INSTRUCTION =
  "Given a text description, retrieve the most relevant taxonomy entry that directly and specifically classifies it. Prefer exact functional, industry, material, or use-case matches over broad parent categories, and do not infer unsupported details.";
const DEFAULT_RERANK_INSTRUCTION =
  "Prioritize the taxonomy entry that most directly and specifically classifies the text description. Favor exact functional, industry, material, and use-case matches over broad parent categories. Penalize candidates that require unsupported inferences.";

interface ClassifierDefinition {
  readonly queryInstruction?: string;
  readonly rerankInstruction?: string;
  readonly collections: Readonly<Record<string, string>>;
}

const CLASSIFIERS: Readonly<Record<string, ClassifierDefinition>> = {
  ETIM: {
    collections: { "ETIM version 10.0 (2024-12-10)": "ETIM_10_1_Qwen3-8B_v1" },
  },
  UNSPSC: {
    queryInstruction:
      "Retrieve the most relevant UNSPSC entry that directly and specifically classifies the given product or service description. Prefer commodity-level matches when available; avoid broad segment or family matches. Do not infer unsupported details.",
    rerankInstruction:
      "Prioritize the UNSPSC entry that most directly and specifically classifies the product or service description. Favor commodity-level matches over broad segment or family matches. Penalize candidates that require unsupported inferences.",
    collections: {
      "UNSPSC UNv260801.1 (18 March 2025)":
        "UNSPSC_UNv260801-1__OR_Qwen3-8B__v2",
    },
  },
  GPC: {
    collections: { "GPC as of May 2026 (v20260520)": "GPC_20260520_v1" },
  },
  EMDN: {
    queryInstruction:
      "Retrieve the most relevant terminal EMDN term that directly and specifically describes the given medical device. Match its intended purpose, device type, design, materials, and clinical application, using hierarchy context to distinguish similar terms. Do not infer unsupported characteristics.",
    rerankInstruction:
      "Prioritize the terminal EMDN term that most directly and specifically describes the medical device, using its title and ancestor hierarchy. Favor exact intended-purpose, device-type, design, material, and clinical-application matches. Penalize candidates that require unsupported inferences.",
    collections: { "EMDN v2026 (English)": "EMDN_2026_EN_Qwen3-8B_v1" },
  },
  NAICS: { collections: { "2022 NAICS": "NAICS_2022_eng_qwen3_8b_2048_v1" } },
  ISIC: {
    collections: {
      "ISIC Rev. 4": "ISIC_Rev4_Qwen3-8B_v1",
      "ISIC Rev. 5": "ISIC_Rev5_Qwen3-8B_v1",
    },
  },
  HS: { collections: { "HS6 2022": "HS6_2022_Qwen3-8B_v1" } },
  CN: { collections: { "CN 2026": "CN2026_Qwen3-8B_v4" } },
  NACE: { collections: { "NACE Rev. 2.1": "NACE_Rev2_1_Qwen3-8B_v2" } },
  CPV: {
    collections: {
      "CPV 2008 (ver. 2013)": "cpv_2008_qwen3_8b_v1",
      "CPV 2008 Supplementary codes": "cpv_2008_supplementary_qwen3_8b_v1",
    },
  },
  NSN: {
    collections: { "NSN extract (February 22, 2023)": "NSN_Qwen3-8B_v1" },
  },
  HTS: {
    collections: {
      "2026 HTS Revision 11 (July 1, 2026)": "HTS_2026_Qwen3-8B_v1",
    },
  },
};

const classifierEnvSchema = z.object({
  HF_EMBEDDING_MODEL: z.string().default("Qwen/Qwen3-Embedding-8B"),
  HF_EMBEDDING_DIMS: z
    .string()
    .trim()
    .regex(/^\d+$/, "must be a positive integer")
    .transform(Number)
    .refine((dims) => dims > 0, "must be a positive integer")
    .default(2048),
});

export function buildClassifierConfig(
  env: NodeJS.ProcessEnv,
): ClassifierConfigMap {
  const { HF_EMBEDDING_MODEL: embedModelName, HF_EMBEDDING_DIMS: embedDims } =
    classifierEnvSchema.parse(env);
  return Object.fromEntries(
    Object.entries(CLASSIFIERS).map(([classifierType, definition]) => [
      classifierType,
      {
        embedModelName,
        embedDims,
        queryInstruction:
          definition.queryInstruction ?? DEFAULT_QUERY_INSTRUCTION,
        rerankInstruction:
          definition.rerankInstruction ?? DEFAULT_RERANK_INSTRUCTION,
        versions: Object.fromEntries(
          Object.entries(definition.collections).map(
            ([version, collectionName]) => [version, { collectionName }],
          ),
        ),
      },
    ]),
  );
}

export function getAllCollectionNames(config: CollectionLayout): string[] {
  const names = new Set(
    Object.values(config).flatMap((classifier) =>
      Object.values(classifier.versions).map(
        (version) => version.collectionName,
      ),
    ),
  );
  return [...names].sort();
}

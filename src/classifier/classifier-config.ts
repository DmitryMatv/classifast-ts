import { z } from "zod";

export interface ClassifierConfig {
  readonly embedDims: number;
  readonly versions: Readonly<
    Record<string, { readonly collectionName: string }>
  >;
}

export type ClassifierConfigMap = Readonly<Record<string, ClassifierConfig>>;

const CLASSIFIER_COLLECTIONS: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  ETIM: { "ETIM version 10.0 (2024-12-10)": "ETIM_10_1_Qwen3-8B_v1" },
  UNSPSC: {
    "UNSPSC UNv260801.1 (18 March 2025)": "UNSPSC_UNv260801-1__OR_Qwen3-8B__v2",
  },
  GPC: { "GPC as of May 2026 (v20260520)": "GPC_20260520_v1" },
  EMDN: { "EMDN v2026 (English)": "EMDN_2026_EN_Qwen3-8B_v1" },
  NAICS: { "2022 NAICS": "NAICS_2022_eng_qwen3_8b_2048_v1" },
  ISIC: {
    "ISIC Rev. 4": "ISIC_Rev4_Qwen3-8B_v1",
    "ISIC Rev. 5": "ISIC_Rev5_Qwen3-8B_v1",
  },
  HS: { "HS6 2022": "HS6_2022_Qwen3-8B_v1" },
  CN: { "CN 2026": "CN2026_Qwen3-8B_v4" },
  NACE: { "NACE Rev. 2.1": "NACE_Rev2_1_Qwen3-8B_v2" },
  CPV: {
    "CPV 2008 (ver. 2013)": "cpv_2008_qwen3_8b_v1",
    "CPV 2008 Supplementary codes": "cpv_2008_supplementary_qwen3_8b_v1",
  },
  NSN: { "NSN extract (February 22, 2023)": "NSN_Qwen3-8B_v1" },
  HTS: { "2026 HTS Revision 11 (July 1, 2026)": "HTS_2026_Qwen3-8B_v1" },
};

const classifierEnvSchema = z.object({
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
  const { HF_EMBEDDING_DIMS: embedDims } = classifierEnvSchema.parse(env);
  return Object.fromEntries(
    Object.entries(CLASSIFIER_COLLECTIONS).map(([classifierType, versions]) => [
      classifierType,
      {
        embedDims,
        versions: Object.fromEntries(
          Object.entries(versions).map(([version, collectionName]) => [
            version,
            { collectionName },
          ]),
        ),
      },
    ]),
  );
}

export function getAllCollectionNames(config: ClassifierConfigMap): string[] {
  const names = new Set(
    Object.values(config).flatMap((classifier) =>
      Object.values(classifier.versions).map(
        (version) => version.collectionName,
      ),
    ),
  );
  return [...names].sort();
}

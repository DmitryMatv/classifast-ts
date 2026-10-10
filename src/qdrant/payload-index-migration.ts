import type { Schemas } from "@qdrant/js-client-rest";
import {
  getAllCollectionNames,
  type CollectionLayout,
} from "../classifier/classifier-config.js";
import {
  normalizeOriginalIdForLookup,
  ORIGINAL_ID_FIELD,
  ORIGINAL_ID_NORMALIZED_FIELD,
  ORIGINAL_ID_NORMALIZED_REVERSED_FIELD,
  originalIdLookupText,
  reverseNormalizedId,
} from "./id-lookup.js";
import {
  errorMessage,
  getPayloadIndexSchema,
  isExpectedPayloadIndex,
  PAYLOAD_INDEX_FIELDS,
  type PayloadIndexField,
  type PayloadIndexInfo,
  type QdrantSchemaReader,
} from "./qdrant-schema.js";

export const BACKFILL_BATCH_SIZE = 100;

type PointId = Schemas["ExtendedPointId"];
type SetPayloadOperation = Schemas["SetPayloadOperation"];

export interface QdrantIndexClient extends QdrantSchemaReader {
  createPayloadIndex(
    collectionName: string,
    request: {
      field_name: string;
      field_schema: Schemas["CreateFieldIndex"]["field_schema"];
      wait: boolean;
    },
  ): Promise<unknown>;
  deletePayloadIndex(
    collectionName: string,
    fieldName: string,
    options: { wait: boolean },
  ): Promise<unknown>;
  scroll(
    collectionName: string,
    request: {
      offset: PointId | undefined;
      limit: number;
      with_payload: string[];
      with_vector: boolean;
    },
  ): Promise<{
    readonly points: readonly {
      readonly id: PointId;
      readonly payload?: Readonly<Record<string, unknown>> | null;
    }[];
    readonly next_page_offset?: Schemas["ScrollResult"]["next_page_offset"];
  }>;
  batchUpdate(
    collectionName: string,
    request: { operations: SetPayloadOperation[]; wait: boolean },
  ): Promise<unknown>;
}

async function deleteExistingIndex(
  client: QdrantIndexClient,
  collectionName: string,
  field: PayloadIndexField,
): Promise<boolean> {
  try {
    await client.deletePayloadIndex(collectionName, field, { wait: true });
    console.log(`  - Deleted existing index on '${field}'`);
    return true;
  } catch (error) {
    console.log(
      `  ! Error deleting index on '${field}': ${errorMessage(error)}`,
    );
    return false;
  }
}

async function createExpectedIndex(
  client: QdrantIndexClient,
  collectionName: string,
  field: PayloadIndexField,
): Promise<boolean> {
  try {
    await client.createPayloadIndex(collectionName, {
      field_name: field,
      field_schema: getPayloadIndexSchema(field),
      wait: true,
    });
    console.log(`  + Recreated expected payload index on '${field}'`);
    return true;
  } catch (error) {
    console.log(
      `  ! Failed to create expected payload index on '${field}': ${errorMessage(error)}`,
    );
    return false;
  }
}

async function restorePreviousIndex(
  client: QdrantIndexClient,
  collectionName: string,
  field: PayloadIndexField,
  previousIndex: PayloadIndexInfo,
): Promise<boolean> {
  try {
    await client.createPayloadIndex(collectionName, {
      field_name: field,
      field_schema: previousIndex.params ?? previousIndex.data_type,
      wait: true,
    });
    console.log(`  ! Rollback succeeded for '${field}'`);
    return true;
  } catch (error) {
    console.log(`  ! Rollback failed for '${field}': ${errorMessage(error)}`);
    return false;
  }
}

function nextScrollOffset(
  offset: Schemas["ScrollResult"]["next_page_offset"],
): PointId | undefined {
  if (offset === null || offset === undefined) return undefined;
  if (typeof offset === "object") {
    throw new Error(`unexpected scroll offset ${JSON.stringify(offset)}`);
  }
  return offset;
}

function buildNormalizedIdPayload(originalId: string): Record<string, string> {
  const normalized = normalizeOriginalIdForLookup(originalId);
  return {
    [ORIGINAL_ID_NORMALIZED_FIELD]: normalized,
    [ORIGINAL_ID_NORMALIZED_REVERSED_FIELD]: reverseNormalizedId(normalized),
  };
}

async function flushPayloadBackfillBatch(
  client: QdrantIndexClient,
  collectionName: string,
  operations: SetPayloadOperation[],
): Promise<boolean> {
  if (operations.length === 0) return true;
  try {
    await client.batchUpdate(collectionName, { operations, wait: true });
    return true;
  } catch (error) {
    console.log(
      `  ! Failed to backfill normalized ID payloads: ${errorMessage(error)}`,
    );
    return false;
  }
}

export async function backfillNormalizedIdPayloads(
  client: QdrantIndexClient,
  collectionName: string,
  batchSize = BACKFILL_BATCH_SIZE,
): Promise<boolean> {
  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let missingOriginalId = 0;
  let offset: PointId | undefined;
  let operations: SetPayloadOperation[] = [];
  let success = true;

  try {
    do {
      const page = await client.scroll(collectionName, {
        offset,
        limit: batchSize,
        with_payload: [
          ORIGINAL_ID_FIELD,
          ORIGINAL_ID_NORMALIZED_FIELD,
          ORIGINAL_ID_NORMALIZED_REVERSED_FIELD,
        ],
        with_vector: false,
      });

      for (const point of page.points) {
        scanned += 1;
        const payload = point.payload ?? {};
        const originalId = payload[ORIGINAL_ID_FIELD];
        if (originalId === undefined || originalId === null) {
          missingOriginalId += 1;
          continue;
        }
        const originalIdValue = originalIdLookupText(originalId);
        if (originalIdValue === undefined) {
          console.log(
            `  ! Point ${point.id} has an unsupported original_id: ${JSON.stringify(originalId)}`,
          );
          success = false;
          continue;
        }

        const expectedPayload = buildNormalizedIdPayload(originalIdValue);
        if (
          Object.entries(expectedPayload).every(
            ([field, value]) => payload[field] === value,
          )
        ) {
          skipped += 1;
          continue;
        }

        operations.push({
          set_payload: { payload: expectedPayload, points: [point.id] },
        });
        updated += 1;

        if (operations.length >= batchSize) {
          success =
            (await flushPayloadBackfillBatch(
              client,
              collectionName,
              operations,
            )) && success;
          operations = [];
        }
      }

      offset = nextScrollOffset(page.next_page_offset);
    } while (offset !== undefined);

    success =
      (await flushPayloadBackfillBatch(client, collectionName, operations)) &&
      success;
  } catch (error) {
    console.log(
      `  ! Error scanning collection for normalized ID backfill: ${errorMessage(error)}`,
    );
    await flushPayloadBackfillBatch(client, collectionName, operations);
    success = false;
  }

  console.log(
    "  * Normalized ID payload backfill: " +
      `scanned=${scanned} updated=${updated} skipped=${skipped} missing_original_id=${missingOriginalId}`,
  );
  return success;
}

export async function migrateCollectionPayloadIndexes(
  client: QdrantIndexClient,
  collectionName: string,
): Promise<boolean> {
  let collectionSuccess = true;

  let collectionInfo;
  try {
    collectionInfo = await client.getCollection(collectionName);
  } catch (error) {
    console.log(
      `  ! Collection not found or unavailable: ${errorMessage(error)}`,
    );
    return false;
  }

  if (!(await backfillNormalizedIdPayloads(client, collectionName))) {
    collectionSuccess = false;
  }

  for (const field of PAYLOAD_INDEX_FIELDS) {
    const existingIndex = collectionInfo.payload_schema[field];

    if (existingIndex === undefined) {
      if (!(await createExpectedIndex(client, collectionName, field))) {
        collectionSuccess = false;
      }
      continue;
    }

    if (isExpectedPayloadIndex(field, existingIndex)) {
      console.log(
        `  = Payload index on '${field}' already matches expected settings`,
      );
      continue;
    }

    console.log(
      `  ~ Replacing existing ${existingIndex.data_type} index on '${field}'`,
    );
    if (!(await deleteExistingIndex(client, collectionName, field))) {
      collectionSuccess = false;
      continue;
    }

    if (!(await createExpectedIndex(client, collectionName, field))) {
      collectionSuccess = false;
      if (
        !(await restorePreviousIndex(
          client,
          collectionName,
          field,
          existingIndex,
        ))
      ) {
        console.log(`  WARNING: '${field}' left without any index!`);
      }
    }
  }

  return collectionSuccess;
}

export async function migrateConfiguredCollections(
  client: QdrantIndexClient,
  config: CollectionLayout,
  collectionNames?: ReadonlySet<string>,
): Promise<{ successCount: number; errorCount: number }> {
  const namesToProcess = collectionNames
    ? [...collectionNames].sort()
    : getAllCollectionNames(config);
  let successCount = 0;
  let errorCount = 0;

  console.log(
    `\nFound ${namesToProcess.length} configured collections to process:\n`,
  );

  for (const collectionName of namesToProcess) {
    console.log(`\nProcessing remediation for: ${collectionName}`);
    if (await migrateCollectionPayloadIndexes(client, collectionName)) {
      successCount += 1;
    } else {
      errorCount += 1;
    }
  }

  return { successCount, errorCount };
}

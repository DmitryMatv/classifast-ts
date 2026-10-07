import unittest

from qdrant_client import models

from app import qdrant_schema
from app.id_lookup import (
    ORIGINAL_ID_FIELD,
    ORIGINAL_ID_NORMALIZED_FIELD,
    ORIGINAL_ID_NORMALIZED_REVERSED_FIELD,
)


class QdrantIndexContractTests(unittest.TestCase):
    def test_original_id_schema_is_keyword_for_exact_and_partial_contract(self):
        schema = qdrant_schema.get_payload_index_schema(ORIGINAL_ID_FIELD)

        self.assertIsInstance(schema, models.KeywordIndexParams)
        self.assertEqual(schema.type, "keyword")

    def test_normalized_id_schema_is_prefix_text_for_partial_contract(self):
        for field_name in (
            ORIGINAL_ID_NORMALIZED_FIELD,
            ORIGINAL_ID_NORMALIZED_REVERSED_FIELD,
        ):
            schema = qdrant_schema.get_payload_index_schema(field_name)

            self.assertIsInstance(schema, models.TextIndexParams)
            self.assertEqual(schema.type, "text")
            self.assertEqual(schema.tokenizer, models.TokenizerType.PREFIX)
            self.assertEqual(schema.min_token_len, 1)
            self.assertEqual(schema.max_token_len, 64)
            self.assertTrue(schema.lowercase)


if __name__ == "__main__":
    unittest.main()

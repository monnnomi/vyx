-- Repair JSON encoded as a JSON string by the PostgreSQL client. Retains content, status and publication history.
UPDATE news_items SET
 body_en=CASE WHEN jsonb_typeof(body_en)='string' THEN (body_en#>>'{}')::jsonb ELSE body_en END,
 body_ru=CASE WHEN jsonb_typeof(body_ru)='string' THEN (body_ru#>>'{}')::jsonb ELSE body_ru END,
 presentation=CASE WHEN jsonb_typeof(presentation)='string' THEN (presentation#>>'{}')::jsonb ELSE presentation END,
 verification=CASE WHEN jsonb_typeof(verification)='string' THEN (verification#>>'{}')::jsonb ELSE verification END
WHERE jsonb_typeof(body_en)='string' OR jsonb_typeof(body_ru)='string' OR jsonb_typeof(presentation)='string' OR jsonb_typeof(verification)='string';

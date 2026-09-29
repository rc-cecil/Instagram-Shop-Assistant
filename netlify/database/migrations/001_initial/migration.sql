CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, value jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS products (
  id text PRIMARY KEY, name text NOT NULL, source_url text NOT NULL UNIQUE,
  description text, shein_usd numeric(10,2), sizes jsonb NOT NULL DEFAULT '[]',
  colours jsonb NOT NULL DEFAULT '[]', stock_status text NOT NULL DEFAULT 'unverified',
  approved boolean NOT NULL DEFAULT false, excluded boolean NOT NULL DEFAULT false,
  note text, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS photos (
  id uuid PRIMARY KEY, product_id text NOT NULL REFERENCES products(id),
  blob_key text, source_file_id text, sha256 text NOT NULL, phash text,
  status text NOT NULL DEFAULT 'needs_review', image_url text,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(sha256)
);
CREATE INDEX IF NOT EXISTS photos_phash_idx ON photos(phash);
CREATE TABLE IF NOT EXISTS posts (
  id uuid PRIMARY KEY, photo_id uuid NOT NULL UNIQUE REFERENCES photos(id),
  slot_date date, slot_time text, caption text, status text NOT NULL DEFAULT 'draft',
  media_container_id text, media_id text UNIQUE, permalink text,
  attempted_at timestamptz, published_at timestamptz, error text
);
CREATE TABLE IF NOT EXISTS conversations (
  id text PRIMARY KEY, handle text, status text NOT NULL DEFAULT 'new',
  human_takeover boolean NOT NULL DEFAULT false, last_message_at timestamptz,
  last_reply_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY, meta_id text UNIQUE, conversation_id text NOT NULL REFERENCES conversations(id),
  direction text NOT NULL, body text, attachment_url text,
  status text NOT NULL DEFAULT 'received', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id text PRIMARY KEY, payload jsonb NOT NULL, status text NOT NULL DEFAULT 'pending',
  error text, received_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz
);
CREATE TABLE IF NOT EXISTS reply_jobs (
  id uuid PRIMARY KEY, inbound_meta_id text NOT NULL UNIQUE, conversation_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending', reserved_cents integer NOT NULL DEFAULT 0,
  error text, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS orders (
  id text PRIMARY KEY, conversation_id text NOT NULL REFERENCES conversations(id),
  product_id text NOT NULL REFERENCES products(id), size text, colour text,
  quantity integer NOT NULL CHECK (quantity > 0), delivery_location text,
  item_total_ghs numeric(10,2), agreed_amount_ghs numeric(10,2),
  status text NOT NULL DEFAULT 'draft', payment_evidence text,
  approved_by text, approved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cart_tasks (
  id uuid PRIMARY KEY, order_id text NOT NULL UNIQUE REFERENCES orders(id),
  status text NOT NULL DEFAULT 'pending_manual', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ai_usage (
  id uuid PRIMARY KEY, conversation_id text, model text NOT NULL, input_tokens integer,
  output_tokens integer, actual_cents integer NOT NULL DEFAULT 0,
  reserved_cents integer NOT NULL DEFAULT 0, status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS activity (
  id uuid PRIMARY KEY, kind text NOT NULL, entity_id text, detail text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sync_jobs (
  id uuid PRIMARY KEY, kind text NOT NULL, entity_id text NOT NULL, status text NOT NULL DEFAULT 'pending',
  error text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(kind, entity_id)
);
INSERT INTO settings(key,value) VALUES
  ('automation', '{"replies":false,"posting":false}'::jsonb),
  ('ai_cap_cents', '500'::jsonb),
  ('shop', '{"account":"_testing.account1","momo":"0551203306","delivery":"About two weeks from confirmed payment; contact customer when ready","timezone":"Africa/Accra"}'::jsonb)
ON CONFLICT (key) DO NOTHING;

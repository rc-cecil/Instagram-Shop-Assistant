CREATE TABLE IF NOT EXISTS shops (
  id text PRIMARY KEY,
  name text NOT NULL,
  instagram_username text NOT NULL UNIQUE,
  timezone text NOT NULL DEFAULT 'Africa/Accra',
  payment_number text NOT NULL,
  payment_method text NOT NULL DEFAULT 'MoMo',
  markup_usd numeric(10,2) NOT NULL DEFAULT 5,
  usd_to_ghs numeric(10,4) NOT NULL DEFAULT 13,
  delivery_message text NOT NULL,
  drive_folder_id text NOT NULL,
  tracker_sheet_id text NOT NULL,
  google_credential_env text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO shops (
  id,name,instagram_username,payment_number,delivery_message,
  drive_folder_id,tracker_sheet_id,google_credential_env,enabled
) VALUES (
  'mivelle','Mivelle','_testing.account1','0551203306',
  'Delivery is expected about two weeks from confirmed payment. You will be contacted when the order is ready for delivery.',
  '1egAhH0ODEbFm8fKyxpMe1aPEklf2cWhG','1Cjp7kBqiDRF77eFO5KzD_XXPH513keAIAtvqbAFp5HQ',
  'GOOGLE_SERVICE_ACCOUNT_JSON',false
) ON CONFLICT (id) DO UPDATE SET
  drive_folder_id=EXCLUDED.drive_folder_id,
  tracker_sheet_id=EXCLUDED.tracker_sheet_id,
  google_credential_env=EXCLUDED.google_credential_env;

ALTER TABLE photos ADD COLUMN IF NOT EXISTS shop_id text REFERENCES shops(id) DEFAULT 'mivelle';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS shop_id text REFERENCES shops(id) DEFAULT 'mivelle';
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS shop_id text REFERENCES shops(id) DEFAULT 'mivelle';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS shop_id text REFERENCES shops(id) DEFAULT 'mivelle';
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS shop_id text REFERENCES shops(id) DEFAULT 'mivelle';
ALTER TABLE reply_jobs ADD COLUMN IF NOT EXISTS shop_id text REFERENCES shops(id) DEFAULT 'mivelle';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shop_id text REFERENCES shops(id) DEFAULT 'mivelle';
ALTER TABLE cart_tasks ADD COLUMN IF NOT EXISTS shop_id text REFERENCES shops(id) DEFAULT 'mivelle';
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS shop_id text REFERENCES shops(id) DEFAULT 'mivelle';
ALTER TABLE activity ADD COLUMN IF NOT EXISTS shop_id text REFERENCES shops(id) DEFAULT 'mivelle';
ALTER TABLE sync_jobs ADD COLUMN IF NOT EXISTS shop_id text REFERENCES shops(id) DEFAULT 'mivelle';

UPDATE photos SET shop_id='mivelle' WHERE shop_id IS NULL;
UPDATE posts SET shop_id='mivelle' WHERE shop_id IS NULL;
UPDATE conversations SET shop_id='mivelle' WHERE shop_id IS NULL;
UPDATE messages SET shop_id='mivelle' WHERE shop_id IS NULL;
UPDATE webhook_events SET shop_id='mivelle' WHERE shop_id IS NULL;
UPDATE reply_jobs SET shop_id='mivelle' WHERE shop_id IS NULL;
UPDATE orders SET shop_id='mivelle' WHERE shop_id IS NULL;
UPDATE cart_tasks SET shop_id='mivelle' WHERE shop_id IS NULL;
UPDATE ai_usage SET shop_id='mivelle' WHERE shop_id IS NULL;
UPDATE activity SET shop_id='mivelle' WHERE shop_id IS NULL;
UPDATE sync_jobs SET shop_id='mivelle' WHERE shop_id IS NULL;

CREATE INDEX IF NOT EXISTS photos_shop_idx ON photos(shop_id);
CREATE INDEX IF NOT EXISTS posts_shop_idx ON posts(shop_id);
CREATE INDEX IF NOT EXISTS conversations_shop_idx ON conversations(shop_id);
CREATE INDEX IF NOT EXISTS messages_shop_idx ON messages(shop_id);
CREATE INDEX IF NOT EXISTS orders_shop_idx ON orders(shop_id);
CREATE INDEX IF NOT EXISTS activity_shop_idx ON activity(shop_id);


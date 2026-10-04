INSERT INTO settings(key,value) VALUES ('launch_review','{"approved":false,"approvedBy":null,"approvedAt":null}'::jsonb) ON CONFLICT(key) DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS one_active_reply_per_conversation
ON reply_jobs(conversation_id) WHERE status IN ('processing','sending');
CREATE UNIQUE INDEX IF NOT EXISTS one_open_agreement_per_conversation
ON orders(conversation_id) WHERE status='awaiting_customer_agreement';
CREATE UNIQUE INDEX IF NOT EXISTS one_post_per_slot
ON posts(slot_date,slot_time) WHERE slot_time!='historical';

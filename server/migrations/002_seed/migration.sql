INSERT INTO products(id,name,source_url,note) VALUES
('441373409','Manfinity Joysei contrast-colour round-neck T-shirt','https://m.shein.com/Manfinity-Joysei-Men-s-Contrast-Color-Round-Neck-Short-Sleeve-Casual-T-Shirt-Versatile-For-Daily-Wear-In-Summer-p-441373409.html','Previously posted; inspect exact variant before quoting'),
('565887545','Manfinity Homme crew-neck T-shirt','https://m.shein.com/Manfinity-Homme-Men-s-Fashionable-Elegant-Top-Men-s-Casual-Comfortable-Crew-Neck-T-Shirt-Men-s-Outdoor-Sports-Top-p-565887545.html','Previously posted; inspect exact variant before quoting'),
('561621365','Manfinity Joysei Catalunya 1899 stripe polo','https://m.shein.com/Manfinity-Joysei-Men-s-Casual-College-Letter-Stripe-Short-Sleeve-Polo-Shirt-Formal-Old-Money-p-561621365.html','Verified M multicolor variant $12.40 on 2026-09-28; recheck live price and availability'),
('13487886','Manfinity Homme plant-print button-up shirt','https://m.shein.com/Manfinity-Homme-Men-Plants-Print-Button-Up-Shirt-Without-Tee-p-13487886.html','White image posted during supervised test'),
('536611869','Manfinity Hypemode colourblock polo','https://m.shein.com/Manfinity-Hypemode-Men-s-American-Retro-Wave-Colorblock-Denim-Effect-Patchwork-Polo-Shirt-p-536611869.html',null),
('525579927','Manfinity Hypemode knight graphic T-shirt','https://m.shein.com/Manfinity-Hypemode-Men-s-Knight-Graphic-Casual-Daily-Wear-Holiday-Short-Sleeve-Embroidered-Hourse-Pattern-T-Shirt-p-525579927.html',null),
('132032391','Manfinity Dauomo letter-print T-shirt','https://m.shein.com/Manfinity-Dauomo-Men-s-Letter-Print-Round-Neck-Short-Sleeve-Casual-T-Shirt-p-132032391.html',null),
('376697584','Men’s minimalist printed T-shirt','https://m.shein.com/Men-s-Minimalist-Printed-Short-Sleeve-T-Shirt-Leading-The-Fashion-Streetwear-p-376697584.html',null),
('558991399','Lonveris spider-pattern T-shirt','https://m.shein.com/Lonveris-Men-s-Spider-Pattern-Printed-Crew-Neck-Short-Sleeve-T-Shirt-p-558991399.html',null),
('471214164','Barcelona 10 jersey-style polo','https://m.shein.com/Men-s-Barcelona-Football-Jersey-Style-Polo-Shirt-Striped-Pattern-T-Shirt-Retro-Fabric-Modern-Loose-Fit-Sports-Streetwear-For-Summer-p-471214164.html','Distinct from Catalunya 1899')
ON CONFLICT (id) DO NOTHING;
UPDATE products SET shein_usd=12.40, sizes='["M"]'::jsonb, colours='["Multicolor / Catalunya 1899"]'::jsonb WHERE id='561621365';
INSERT INTO conversations(id,handle,status) VALUES ('IG-114210563301570','_rc.cecil','waiting_payment') ON CONFLICT(id) DO NOTHING;
INSERT INTO orders(id,conversation_id,product_id,size,colour,quantity,delivery_location,item_total_ghs,agreed_amount_ghs,status)
VALUES ('ORD-20260928-001','IG-114210563301570','561621365','M','Multicolor / Catalunya 1899',2,'Jean Nelson Hall',452.40,452.40,'awaiting_payment_evidence')
ON CONFLICT(id) DO NOTHING;

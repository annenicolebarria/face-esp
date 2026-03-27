-- Seed data for first run
-- Default admin login:
-- username: admin
-- password: admin

INSERT INTO admins (username, password_hash)
VALUES ('admin', '$2b$10$SS7HApTChY7sWuFQCzPL7.QT1Jj6bf2WduOzdMY2ADTm7Vy0EuSWC')
ON CONFLICT (username) DO NOTHING;

INSERT INTO fan_state (device_key, is_on, updated_at, updated_by_label)
VALUES ('main_fan', FALSE, NOW(), 'system')
ON CONFLICT (device_key) DO NOTHING;

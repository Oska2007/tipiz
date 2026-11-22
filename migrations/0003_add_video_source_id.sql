-- movies සහ episodes වලට video_source_id එකතු කිරීම
ALTER TABLE movies ADD COLUMN video_source_id TEXT;
ALTER TABLE episodes ADD COLUMN video_source_id TEXT;
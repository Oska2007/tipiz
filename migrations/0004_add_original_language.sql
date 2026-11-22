ALTER TABLE movies ADD COLUMN original_language TEXT;
ALTER TABLE tv_series ADD COLUMN original_language TEXT;

CREATE INDEX idx_movies_status_language
  ON movies (status, original_language);
CREATE INDEX idx_tv_status_language
  ON tv_series (status, original_language);

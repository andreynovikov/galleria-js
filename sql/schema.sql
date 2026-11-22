CREATE TABLE image (
    id SERIAL PRIMARY KEY,
    name character varying NOT NULL,
    bundle character varying NOT NULL,
    width integer DEFAULT 0 NOT NULL,
    height integer DEFAULT 0 NOT NULL,
    orientation integer DEFAULT 0 NOT NULL,
    stime timestamp without time zone,
    author integer,
    description text,
    lat6 integer,
    lon6 integer,
    ctime timestamp without time zone,
    mtime timestamp without time zone,
    starred integer DEFAULT 0 NOT NULL,
    exportable boolean DEFAULT true NOT NULL,
    censored integer DEFAULT 0 NOT NULL,
    exif jsonb
);

CREATE TABLE label (
    id SERIAL PRIMARY KEY,
    name character varying NOT NULL
);

CREATE TABLE label_image (
    image integer NOT NULL,
    label integer NOT NULL
);

-- Partitioned by month (log_YYYY_MM), so old months are dropped as a whole (LOG_RETENTION_DAYS). The app creates the
-- partitions ahead (lib/log-retention.ts); the default partition takes rows of months without one.
CREATE TABLE log (
    image integer NOT NULL,
    ip inet NOT NULL,
    status integer NOT NULL,
    ctime timestamp without time zone DEFAULT now() NOT NULL,
    visitor_id character varying,
    visitor_provider character varying,
    meta jsonb
) PARTITION BY RANGE (ctime);

CREATE TABLE log_default PARTITION OF log DEFAULT;

CREATE TABLE visitor (
    id character varying NOT NULL,
    provider character varying NOT NULL,
    data jsonb,
    censorship integer DEFAULT 0 NOT NULL
);

CREATE UNIQUE INDEX image_bundle_name ON image USING btree (bundle, name);

CREATE UNIQUE INDEX label_name ON label USING btree (name);

CREATE UNIQUE INDEX label_image_label_image ON label_image USING btree (label, image);

CREATE INDEX label_image_image ON label_image USING btree (image);

CREATE INDEX log_image ON log USING btree (image);

CREATE INDEX log_ctime ON log USING btree (ctime);

CREATE INDEX log_ip_ctime ON log USING btree (ip, ctime);

CREATE UNIQUE INDEX visitor_id ON visitor USING btree (id, provider);

ALTER TABLE ONLY label_image
    ADD CONSTRAINT label_image_image_fkey FOREIGN KEY (image) REFERENCES image(id) ON DELETE CASCADE;

ALTER TABLE ONLY label_image
    ADD CONSTRAINT label_image_label_fkey FOREIGN KEY (label) REFERENCES label(id) ON DELETE RESTRICT;

ALTER TABLE log
    ADD CONSTRAINT log_image_fkey FOREIGN KEY (image) REFERENCES image(id) ON DELETE CASCADE;
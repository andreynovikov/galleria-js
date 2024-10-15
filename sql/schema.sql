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
    censored integer DEFAULT 0 NOT NULL
);

CREATE TABLE label (
    id SERIAL PRIMARY KEY,
    name character varying NOT NULL
);

CREATE TABLE label_image (
    image integer NOT NULL,
    label integer NOT NULL
);

CREATE TABLE log (
    image integer NOT NULL,
    "user" character varying(60) NOT NULL,
    status integer NOT NULL,
    ctime timestamp without time zone DEFAULT now()
);

CREATE INDEX image_bundle ON image USING btree (bundle);

CREATE UNIQUE INDEX label_name ON label USING btree (name);

CREATE UNIQUE INDEX label_image_label_image ON label_image USING btree (label, image);

ALTER TABLE ONLY label_image
    ADD CONSTRAINT label_image_image_fkey FOREIGN KEY (image) REFERENCES image(id) ON DELETE CASCADE;

ALTER TABLE ONLY label_image
    ADD CONSTRAINT label_image_label_fkey FOREIGN KEY (label) REFERENCES label(id) ON DELETE RESTRICT;

ALTER TABLE ONLY log
    ADD CONSTRAINT log_image_fkey FOREIGN KEY (image) REFERENCES image(id) ON DELETE CASCADE;
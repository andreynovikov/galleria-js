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

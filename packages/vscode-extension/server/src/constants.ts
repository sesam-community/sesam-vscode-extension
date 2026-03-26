import type { DtlSettings, SystemTypeInfo, SourceTypeInfo } from "./server.types";

// ---------------------------------------------------------------------------
// Default settings
// ---------------------------------------------------------------------------
export const defaultSettings: DtlSettings = {
  maxNumberOfProblems: 100,
  validate: {
    enabled: true,
    unknownFunctions: true,
    argCount: true,
    jsonSyntax: true,
    dtlStructure: true,
    transformInExpression: true,
    pathExpressions: false,
    configStructure: true,
  },
};

// ---------------------------------------------------------------------------
// System-type completions data
// ---------------------------------------------------------------------------
export const SYSTEM_TYPES: SystemTypeInfo[] = [
  {
    label: "system:elasticsearch",
    detail: "Elasticsearch system",
    doc: "Connect to an Elasticsearch cluster for indexing and querying.",
  },
  {
    label: "system:kafka",
    detail: "Kafka system",
    doc: "Connect to an Apache Kafka broker for producing/consuming messages.",
  },
  {
    label: "system:ldap",
    detail: "LDAP system",
    doc: "Connect to an LDAP/Active Directory server.",
  },
  {
    label: "system:microservice",
    detail: "Microservice system",
    doc: "Manages a Docker-based microservice running inside the Sesam node.",
  },
  {
    label: "system:mssql",
    detail: "Microsoft SQL Server system",
    doc: "Connect to a Microsoft SQL Server database.",
  },
  {
    label: "system:mssql-legacy",
    detail: "Legacy Microsoft SQL Server system",
    doc: "Legacy connector for Microsoft SQL Server (older driver).",
  },
  {
    label: "system:mysql",
    detail: "MySQL / MariaDB system",
    doc: "Connect to a MySQL or MariaDB database.",
  },
  {
    label: "system:oracle",
    detail: "Oracle Database system (JDBC)",
    doc: "Connect to an Oracle Database using JDBC.",
  },
  {
    label: "system:oracle_tns",
    detail: "Oracle Database system (TNS)",
    doc: "Connect to an Oracle Database via a TNS alias.",
  },
  {
    label: "system:postgresql",
    detail: "PostgreSQL system",
    doc: "Connect to a PostgreSQL database.",
  },
  {
    label: "system:rest",
    detail: "REST system",
    doc: "Generic REST/HTTP system with OAuth2, headers, operations, and retry config.",
  },
  {
    label: "system:smtp",
    detail: "SMTP system",
    doc: "Send email via an SMTP server.",
  },
  {
    label: "system:solr",
    detail: "Apache Solr system",
    doc: "Connect to an Apache Solr search platform.",
  },
  {
    label: "system:twilio",
    detail: "Twilio system",
    doc: "Send SMS/voice messages via Twilio.",
  },
  {
    label: "system:url",
    detail: "URL system",
    doc: "Simple HTTP/HTTPS system — the lightweight alternative to `system:rest`.",
  },
];

// ---------------------------------------------------------------------------
// Source-type completions data
// ---------------------------------------------------------------------------
export const PIPE_SOURCE_TYPES: SourceTypeInfo[] = [
  {
    label: "dataset",
    detail: "Read from a Sesam dataset",
    doc: "Reads entities from a Sesam dataset.\n\nRequired: `dataset`",
  },
  {
    label: "sql",
    detail: "Read from a SQL table via a SQL system",
    doc: "Reads rows from a SQL table via a SQL system.\n\nRequired: `system`, `table`",
  },
  {
    label: "rest",
    detail: "Read from a REST API via a REST system",
    doc: "Reads entities from a REST API via a REST system.\n\nRequired: `system`, `operation`",
  },
  {
    label: "json",
    detail: "Read JSON from a URL via a URL/REST system",
    doc: "Reads a JSON document from a URL.\n\nRequired: `system`, `url`",
  },
  {
    label: "csv",
    detail: "Read CSV via a URL/REST system",
    doc: "Reads a CSV file and emits one entity per row.\n\nRequired: `system`, `url`",
  },
  {
    label: "http_endpoint",
    detail: "Receive data pushed to an HTTP endpoint",
    doc: "Creates an HTTP inbound endpoint. Entities are pushed to it by an external system.",
  },
  {
    label: "embedded",
    detail: "Inline entities defined in the config",
    doc: "Emits a static list of entities defined directly in the config.\n\nRequired: `entities` (array)",
  },
  {
    label: "empty",
    detail: "Emits no entities (placeholder / testing)",
    doc: "Produces no entities — useful for placeholder pipes or testing transforms.",
  },
  {
    label: "union_datasets",
    detail: "Union multiple datasets into one stream",
    doc: "Merges the entity streams of several datasets (set union).\n\nRequired: `datasets` (array of dataset IDs)",
  },
  {
    label: "merge",
    detail: "Merge entities from multiple sources",
    doc: "Merges multiple source streams, grouping entities by `_id`.\n\nRequired: `sources` (array of source objects)",
  },
  {
    label: "merge_datasets",
    detail: "Keep latest version of each entity across datasets",
    doc: "Merges datasets and retains the latest version of each entity.\n\nRequired: `datasets` (array of dataset IDs)",
  },
  {
    label: "conditional",
    detail: "Pick a source based on a runtime condition",
    doc: "Selects from alternative source configs based on a runtime expression.\n\nRequired: `condition`, `alternatives`",
  },
  {
    label: "kafka",
    detail: "Read from Kafka via a Kafka system",
    doc: "Reads messages from a Kafka topic.\n\nRequired: `system`",
  },
  {
    label: "ldap",
    detail: "Read from LDAP via an LDAP system",
    doc: "Reads entries from an LDAP directory.\n\nRequired: `system`",
  },
  {
    label: "binary",
    detail: "Read binary data via a system",
    doc: "Reads binary blobs via a system that supports binary operations.\n\nRequired: `system`, `operation`",
  },
  {
    label: "sdshare",
    detail: "Read from an SDShare feed",
    doc: "Reads RDF fragments from an SDShare feed.\n\nRequired: `url`",
  },
  {
    label: "sparql",
    detail: "Read from a SPARQL endpoint",
    doc: "Executes a SPARQL query against an endpoint.\n\nRequired: `url`",
  },
  {
    label: "rdf",
    detail: "Read RDF data from a URL",
    doc: "Reads RDF data (Turtle, N-Triples, RDF/XML, …) from a URL.\n\nRequired: `url`",
  },
];

// ---------------------------------------------------------------------------
// Transform-type valid values
// Docs: https://docs.sesam.io/hub/documentation/service-configuration/pipes/configuration-transforms.html
// ---------------------------------------------------------------------------
export const TRANSFORM_TYPES: ReadonlySet<string> = new Set([
  "dtl",
  "http",
  "rest",
  "conditional",
  "emit_children",
  "json_schema_validation",
  "rdf",
  "template",
  "xml",
]);

// ---------------------------------------------------------------------------
// Sink-type valid values
// Docs: https://docs.sesam.io/hub/documentation/service-configuration/pipes/configuration-sinks.html
// ---------------------------------------------------------------------------
export const SINK_TYPES: ReadonlySet<string> = new Set([
  "dataset",
  "sql",
  "rest",
  "conditional",
  "csv_endpoint",
  "elasticsearch",
  "email",
  "http_endpoint",
  "json",
  "kafka",
  "null",
  "sdshare",
  "sms",
  "solr",
  "sparql",
  "xml_endpoint",
]);

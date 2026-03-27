import type {
  DtlSettings,
  SystemTypeInfo,
  SourceTypeInfo,
  TransformTypeInfo,
} from "./server.types";

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
  format: {
    reorderKeys: true,
  },
};

// ---------------------------------------------------------------------------
// System-type completions data
// ---------------------------------------------------------------------------
const SYS_DOCS =
  "https://docs.sesam.io/hub/documentation/service-configuration/systems/configuration-systems";

export const SYSTEM_TYPES: SystemTypeInfo[] = [
  {
    label: "system:elasticsearch",
    detail: "Elasticsearch system",
    doc: "Connect to an Elasticsearch cluster for indexing and querying.",
    docUrl: `${SYS_DOCS}-elasticsearch.html`,
  },
  {
    label: "system:kafka",
    detail: "Kafka system",
    doc: "Connect to an Apache Kafka broker for producing/consuming messages.",
    docUrl: `${SYS_DOCS}-kafka.html`,
  },
  {
    label: "system:ldap",
    detail: "LDAP system",
    doc: "Connect to an LDAP/Active Directory server.",
    docUrl: `${SYS_DOCS}-ldap.html`,
  },
  {
    label: "system:microservice",
    detail: "Microservice system",
    doc: "Manages a Docker-based microservice running inside the Sesam node.",
    docUrl: `${SYS_DOCS}-microservice.html`,
  },
  {
    label: "system:mssql",
    detail: "Microsoft SQL Server system",
    doc: "Connect to a Microsoft SQL Server database.",
    docUrl: `${SYS_DOCS}-mssql.html`,
  },
  {
    label: "system:mssql-legacy",
    detail: "Legacy Microsoft SQL Server system",
    doc: "Legacy connector for Microsoft SQL Server (older driver).",
    docUrl: `${SYS_DOCS}-mssql-legacy.html`,
  },
  {
    label: "system:mysql",
    detail: "MySQL / MariaDB system",
    doc: "Connect to a MySQL or MariaDB database.",
    docUrl: `${SYS_DOCS}-mysql.html`,
  },
  {
    label: "system:oracle",
    detail: "Oracle Database system (JDBC)",
    doc: "Connect to an Oracle Database using JDBC.",
    docUrl: `${SYS_DOCS}-oracle.html`,
  },
  {
    label: "system:oracle_tns",
    detail: "Oracle Database system (TNS)",
    doc: "Connect to an Oracle Database via a TNS alias.",
    docUrl: `${SYS_DOCS}-oracle-tns.html`,
  },
  {
    label: "system:postgresql",
    detail: "PostgreSQL system",
    doc: "Connect to a PostgreSQL database.",
    docUrl: `${SYS_DOCS}-postgresql.html`,
  },
  {
    label: "system:rest",
    detail: "REST system",
    doc: "Generic REST/HTTP system with OAuth2, headers, operations, and retry config.",
    docUrl: `${SYS_DOCS}-rest.html`,
  },
  {
    label: "system:smtp",
    detail: "SMTP system",
    doc: "Send email via an SMTP server.",
    docUrl: `${SYS_DOCS}-smtp.html`,
  },
  {
    label: "system:solr",
    detail: "Apache Solr system",
    doc: "Connect to an Apache Solr search platform.",
    docUrl: `${SYS_DOCS}-solr.html`,
  },
  {
    label: "system:twilio",
    detail: "Twilio system",
    doc: "Send SMS/voice messages via Twilio.",
    docUrl: `${SYS_DOCS}-twilio.html`,
  },
  {
    label: "system:url",
    detail: "URL system",
    doc: "Simple HTTP/HTTPS system — the lightweight alternative to `system:rest`.",
    docUrl: `${SYS_DOCS}-url.html`,
  },
];

// ---------------------------------------------------------------------------
// Source-type completions data
// ---------------------------------------------------------------------------
const SRC_DOCS =
  "https://docs.sesam.io/hub/documentation/service-configuration/pipes/configuration-sources";

export const PIPE_SOURCE_TYPES: SourceTypeInfo[] = [
  {
    label: "dataset",
    detail: "Read from a Sesam dataset",
    doc: "Reads entities from a Sesam dataset.\n\nRequired: `dataset`",
    docUrl: `${SRC_DOCS}-dataset.html`,
  },
  {
    label: "sql",
    detail: "Read from a SQL table via a SQL system",
    doc: "Reads rows from a SQL table via a SQL system.\n\nRequired: `system`, `table`",
    docUrl: `${SRC_DOCS}-sql.html`,
  },
  {
    label: "rest",
    detail: "Read from a REST API via a REST system",
    doc: "Reads entities from a REST API via a REST system.\n\nRequired: `system`, `operation`",
    docUrl: `${SRC_DOCS}-rest.html`,
  },
  {
    label: "json",
    detail: "Read JSON from a URL via a URL/REST system",
    doc: "Reads a JSON document from a URL.\n\nRequired: `system`, `url`",
    docUrl: `${SRC_DOCS}-json.html`,
  },
  {
    label: "csv",
    detail: "Read CSV via a URL/REST system",
    doc: "Reads a CSV file and emits one entity per row.\n\nRequired: `system`, `url`",
    docUrl: `${SRC_DOCS}-csv.html`,
  },
  {
    label: "http_endpoint",
    detail: "Receive data pushed to an HTTP endpoint",
    doc: "Creates an HTTP inbound endpoint. Entities are pushed to it by an external system.",
    docUrl: `${SRC_DOCS}-http.html`,
  },
  {
    label: "embedded",
    detail: "Inline entities defined in the config",
    doc: "Emits a static list of entities defined directly in the config.\n\nRequired: `entities` (array)",
    docUrl: `${SRC_DOCS}-embedded.html`,
  },
  {
    label: "empty",
    detail: "Emits no entities (placeholder / testing)",
    doc: "Produces no entities — useful for placeholder pipes or testing transforms.",
    docUrl: `${SRC_DOCS}-empty.html`,
  },
  {
    label: "union_datasets",
    detail: "Union multiple datasets into one stream",
    doc: "Merges the entity streams of several datasets (set union).\n\nRequired: `datasets` (array of dataset IDs)",
    docUrl: `${SRC_DOCS}-union-datasets.html`,
  },
  {
    label: "merge",
    detail: "Merge entities from multiple sources",
    doc: "Merges multiple source streams, grouping entities by `_id`.\n\nRequired: `sources` (array of source objects)",
    docUrl: `${SRC_DOCS}-merge.html`,
  },
  {
    label: "merge_datasets",
    detail: "Keep latest version of each entity across datasets",
    doc: "Merges datasets and retains the latest version of each entity.\n\nRequired: `datasets` (array of dataset IDs)",
    docUrl: `${SRC_DOCS}-merge-datasets.html`,
  },
  {
    label: "conditional",
    detail: "Pick a source based on a runtime condition",
    doc: "Selects from alternative source configs based on a runtime expression.\n\nRequired: `condition`, `alternatives`",
    docUrl: `${SRC_DOCS}-conditional.html`,
  },
  {
    label: "kafka",
    detail: "Read from Kafka via a Kafka system",
    doc: "Reads messages from a Kafka topic.\n\nRequired: `system`",
    docUrl: `${SRC_DOCS}-kafka.html`,
  },
  {
    label: "ldap",
    detail: "Read from LDAP via an LDAP system",
    doc: "Reads entries from an LDAP directory.\n\nRequired: `system`",
    docUrl: `${SRC_DOCS}-ldap.html`,
  },
  {
    label: "binary",
    detail: "Read binary data via a system",
    doc: "Reads binary blobs via a system that supports binary operations.\n\nRequired: `system`, `operation`",
    docUrl: `${SRC_DOCS}-binary.html`,
  },
  {
    label: "sdshare",
    detail: "Read from an SDShare feed",
    doc: "Reads RDF fragments from an SDShare feed.\n\nRequired: `url`",
    docUrl: `${SRC_DOCS}-sdshare.html`,
  },
  {
    label: "sparql",
    detail: "Read from a SPARQL endpoint",
    doc: "Executes a SPARQL query against an endpoint.\n\nRequired: `url`",
    docUrl: `${SRC_DOCS}-sparql.html`,
  },
  {
    label: "rdf",
    detail: "Read RDF data from a URL",
    doc: "Reads RDF data (Turtle, N-Triples, RDF/XML, …) from a URL.\n\nRequired: `url`",
    docUrl: `${SRC_DOCS}-rdf.html`,
  },
];

// ---------------------------------------------------------------------------
// Transform-type completions data
// Docs: https://docs.sesam.io/hub/documentation/service-configuration/pipes/configuration-transforms.html
// ---------------------------------------------------------------------------
const TRF_DOCS =
  "https://docs.sesam.io/hub/documentation/service-configuration/pipes/configuration-transforms";

export const PIPE_TRANSFORM_TYPES: TransformTypeInfo[] = [
  {
    label: "dtl",
    detail: "DTL transform",
    doc: "Applies a DTL rules block to each entity.\n\nRequired: `rules`",
    docUrl: `${TRF_DOCS}-dtl.html`,
  },
  {
    label: "conditional",
    detail: "Conditional transform",
    doc: "Selects from alternative transforms based on a runtime condition.\n\nRequired: `condition`, `alternatives`",
    docUrl: `${TRF_DOCS}-conditional.html`,
  },
  {
    label: "http",
    detail: "HTTP transform",
    doc: "Sends entities to an HTTP endpoint for processing.\n\nRequired: `system`, `operation`",
    docUrl: `${TRF_DOCS}-http.html`,
  },
  {
    label: "rest",
    detail: "REST transform",
    doc: "Sends entities to a REST operation and merges the response back.\n\nRequired: `system`, `operation`",
    docUrl: `${TRF_DOCS}-rest.html`,
  },
  {
    label: "emit_children",
    detail: "Emit children transform",
    doc: "Emits child entities from a list property as individual entities.",
    docUrl: `${TRF_DOCS}-emit-children.html`,
  },
  {
    label: "json_schema_validation",
    detail: "JSON Schema validation transform",
    doc: "Validates each entity against a JSON Schema; marks invalid entities with `_failed`.",
    docUrl: `${TRF_DOCS}-json-schema-validation.html`,
  },
  {
    label: "rdf",
    detail: "RDF transform",
    doc: "Converts entities to/from RDF format.",
    docUrl: `${TRF_DOCS}-rdf.html`,
  },
  {
    label: "template",
    detail: "Template transform",
    doc: "Renders entities using a Jinja2 template string.\n\nRequired: `template`",
    docUrl: `${TRF_DOCS}-template.html`,
  },
  {
    label: "xml",
    detail: "XML transform",
    doc: "Converts entities to/from XML using an XML config.\n\nRequired: `xml_config`",
    docUrl: `${TRF_DOCS}-xml.html`,
  },
];

/** Set of valid transform type strings — used for validation */
export const TRANSFORM_TYPES: ReadonlySet<string> = new Set(
  PIPE_TRANSFORM_TYPES.map((t) => t.label),
);

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

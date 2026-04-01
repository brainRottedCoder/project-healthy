import type {
  HealthReport,
  Finding,
  Severity,
  FindingType,
} from "../types/index.js";

// SARIF 2.1.0 types
interface SarifLog {
  $schema: string;
  version: string;
  runs: SarifRun[];
}

interface SarifRun {
  tool: {
    driver: {
      name: string;
      version: string;
      informationUri: string;
      rules: SarifReportingDescriptor[];
    };
  };
  results: SarifResult[];
}

interface SarifReportingDescriptor {
  id: string;
  shortDescription: { text: string };
  helpUri: string;
}

interface SarifResult {
  ruleId: string;
  level: string;
  message: { text: string };
  locations?: Array<{
    physicalLocation: {
      artifactLocation: { uri: string };
      region: { startLine: number };
    };
  }>;
  fixes?: Array<{
    description: { text: string };
  }>;
}

const severityToSarifLevel: Record<Severity, string> = {
  CRITICAL: "error",
  HIGH: "error",
  MEDIUM: "warning",
  LOW: "note",
};

const findingTypeHumanized: Record<FindingType, string> = {
  SLOW_JOB: "Slow CI Job",
  MISSING_CACHE: "Missing Cache Configuration",
  PARALLEL_OPPORTUNITY: "Parallelization Opportunity",
  ALWAYS_FAILING_STAGE: "Always Failing Stage",
  HIGH_COMPLEXITY: "High Cyclomatic Complexity",
  SLOW_PIPELINE: "Slow Pipeline",
  NO_PARALLELISM: "No Parallelism",
  DUPLICATE_CODE: "Duplicate Code Detected",
  TOO_MANY_PARAMETERS: "Too Many Parameters",
  LARGE_FILE: "Large File",
  DEAD_EXPORT: "Dead Export",
  LINT_ERROR: "Lint Error",
  STALE_DOC: "Stale Documentation",
  SEMANTIC_DRIFT: "Documentation Semantic Drift",
  MISSING_JSDOC: "Missing JSDoc Comment",
  MISSING_CHANGELOG: "Missing Changelog",
  API_DOC_DRIFT: "API Documentation Drift",
  FLAKY_TEST: "Flaky Test",
  CVE: "Known Vulnerability (CVE)",
  LICENSE_RISK: "License Risk",
  OUTDATED_PACKAGE: "Outdated Package",
  LARGE_PR: "Large Pull Request",
  STALE_PR: "Stale Pull Request",
  CROSS_MODULE_PR: "Cross-Module Pull Request",
  MISSING_TESTS: "Missing Tests",
  MISSING_DESCRIPTION: "Missing PR Description",
  NO_REVIEW: "No Review",
  ENV_DRIFT: "Environment Variable Drift",
  SECRET_LEAK: "Secret Leak",
  ENV_EXPOSED: "Environment File Exposed",
  DOCKER_MISMATCH: "Docker Image Mismatch",
  BUILD_BOTTLENECK: "Build Bottleneck",
  UNCACHED_INSTALL: "Uncached Install",
  MISSING_INCREMENTAL_TS: "Missing Incremental TypeScript Compilation",
  CACHE_MISS: "Cache Miss",
  LARGE_BUNDLE: "Large Bundle Size",
  LARGE_CHUNK: "Large Chunk",
  STALE_BUILD: "Stale Build",
  HEAVY_DEPENDENCIES: "Heavy Dependencies",
  DEVDEP_RATIO: "Dev Dependency Ratio",
  TS_NOT_STRICT: "TypeScript Not in Strict Mode",
};

function humanizeFindingType(type: FindingType): string {
  return findingTypeHumanized[type] ?? type.replace(/_/g, " ").toLowerCase();
}

function toFileUri(filePath: string): string {
  if (filePath.startsWith("file://")) return filePath;
  return `file://${filePath.replace(/\\/g, "/")}`;
}

export function toSarif(report: HealthReport): SarifLog {
  const ruleIds = new Set<string>();
  const rules: SarifReportingDescriptor[] = [];
  const results: SarifResult[] = [];

  for (const finding of report.findings) {
    if (!ruleIds.has(finding.type)) {
      ruleIds.add(finding.type);
      rules.push({
        id: finding.type,
        shortDescription: { text: humanizeFindingType(finding.type) },
        helpUri: `https://github.com/your-org/project-health/docs/rules/${finding.type}`,
      });
    }

    const result: SarifResult = {
      ruleId: finding.type,
      level: severityToSarifLevel[finding.severity],
      message: { text: finding.message },
    };

    if (finding.file) {
      result.locations = [
        {
          physicalLocation: {
            artifactLocation: { uri: toFileUri(finding.file) },
            region: { startLine: finding.line ?? 1 },
          },
        },
      ];
    }

    if (finding.fix) {
      result.fixes = [
        {
          description: { text: finding.fix },
        },
      ];
    }

    results.push(result);
  }

  return {
    $schema:
      "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "project-health",
            version: "3.0.0",
            informationUri: "https://github.com/your-org/project-health",
            rules,
          },
        },
        results,
      },
    ],
  };
}

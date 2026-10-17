export interface CoverageRow {
    language: string;
    sections: Record<string, { done: number; total: number }>;
}

export function checkI18n(): { errors: string[]; warnings: string[]; coverage: CoverageRow[] };
export function coverageTable(coverage: CoverageRow[]): string;

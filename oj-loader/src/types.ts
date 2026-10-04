export interface SampleItem {
  id: string;
  text: string;
}

export interface Sample {
  sample: number;
  input: string;
  output: string;
}

export interface ContestLabels {
  kind: "contest-labels";
  contestId: string;
  labels: string[];
}

export interface SingleProblem {
  kind: "single";
  timeLimitMs: number | null;
  memoryLimitMb: number | null;
  items: SampleItem[];
}

export interface CodeforcesMultiProblem {
  letter: string;
  timeLimitMs: number | null;
  memoryLimitMb: number | null;
  items: SampleItem[];
}

export interface CodeforcesMulti {
  kind: "cf-multi";
  contestId: string;
  problems: CodeforcesMultiProblem[];
}

export interface LeetcodeProblem {
  kind: "leetcode";
  frontendId: string | null;
  starterCode: string;
  items: SampleItem[];
}

export type ExtractResult =
  | ContestLabels
  | SingleProblem
  | CodeforcesMulti
  | LeetcodeProblem
  | SampleItem[];

export type Judge = "atcoder" | "codeforces";

export interface SubmitJob {
  id: string;
  judge: string;
  contestId: string;
  problemId: string;
  submitUrl: string;
  statusUrl: string;
  language: string;
  source: string;
  pollTimeoutMs: number;
}

export type VerdictWatchJob = Omit<SubmitJob, "language" | "source"> & {
  submissionId?: string;
};

export interface SubmitResult {
  submitted: boolean;
  posted?: boolean;
  explicit?: boolean;
  needsInteraction?: boolean;
  error?: string;
  language?: string;
}

export interface VerdictRow {
  verdict: string;
  pending: boolean;
  /** Problem the row belongs to, on rows keyed `#<submission id>`; "" when the page omits it. */
  problemId?: string;
  submissionId?: string;
  submissionUrl?: string;
}

export interface VerdictsQuery {
  judge?: string;
  statusUrl: string;
  /** Every row of these problems is also reported by submission id, keyed `#<id>`. */
  problemIds: string[];
}

export interface AntiBotState {
  present: boolean;
  name: string;
  value: string;
}

export interface SubmitOutcome {
  submitted: boolean;
  language?: string;
  verdict?: string;
  accepted?: boolean;
  provisional?: boolean;
  submissionId?: string;
  submissionUrl?: string;
  error?: string;
}

export type ProgressReporter = (
  stage: string,
  message?: string,
  link?: { submissionId?: string; submissionUrl?: string },
) => void;

declare global {
  var __ojLoaderExtractSamplesInPage:
    | ((pageUrl: string) => ExtractResult | Promise<ExtractResult>)
    | undefined;
  var __ojLoaderSubmitInPage: ((job: SubmitJob) => Promise<SubmitResult>) | undefined;
  var __ojLoaderAntiBotInPage:
    | ((opts: { waitMs?: number }) => Promise<AntiBotState>)
    | undefined;
  var __ojLoaderVerdictInPage: ((job: SubmitJob) => Promise<VerdictRow>) | undefined;
  var __ojLoaderVerdictsInPage:
    | ((opts: VerdictsQuery) => Promise<Record<string, VerdictRow>>)
    | undefined;
}

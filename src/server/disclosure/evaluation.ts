const relevanceTerms = ['repair', 'inspection', 'defect', 'damp', 'mould', 'notice', 'survey'];
const privilegeTerms = ['legal advice', 'litigation strategy', 'solicitor advice', 'counsel advice', 'without prejudice'];
const personalTerms = ['date of birth', 'bank account', 'medical record', 'national insurance'];

function matches(text: string, terms: string[]): string[] {
  return terms.filter((term) => text.includes(term));
}

export function evaluateDisclosureDocument(input: {
  sourceHash: string;
  title: string;
  extractedText: string;
  issueTags: string[];
}) {
  const corpus = `${input.title}\n${input.extractedText}`.toLowerCase();
  const relevanceMatches = matches(corpus, relevanceTerms);
  const privilegeMatches = matches(corpus, privilegeTerms);
  const personalMatches = matches(corpus, personalTerms);
  const relevance = relevanceMatches.length > 0 ? 'likely_relevant' as const : 'uncertain' as const;
  const privilegeWarning = privilegeMatches.length > 0 ? 'possible' as const : 'none' as const;
  return {
    relevance,
    privilegeWarning,
    confidentialityWarning: personalMatches.length > 0 ? 'possible' as const : 'none' as const,
    rationale: privilegeWarning === 'possible'
      ? 'Possible restricted language detected; human review for privilege is required.'
      : relevance === 'likely_relevant'
        ? 'Issue-related language detected; human disclosure review is required.'
        : 'No deterministic issue match; human disclosure review is required.',
    citedSpans: [...new Set([...relevanceMatches, ...privilegeMatches, ...personalMatches])],
    suggestedIssueTags: [...new Set(input.issueTags)],
    duplicateHashHint: input.sourceHash,
    model: 'evaluation-local-v1',
    policyVersion: 'disclosure-evaluation-v1',
    sourceHash: input.sourceHash,
  };
}

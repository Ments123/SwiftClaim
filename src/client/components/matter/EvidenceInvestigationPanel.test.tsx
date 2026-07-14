import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { evidenceWorkspace } from './evidence-test-fixture.js';
import { EvidenceInvestigationPanel } from './EvidenceInvestigationPanel.js';

const workspace = {
  ...evidenceWorkspace,
  availableDocumentVersions: [{
    id: 'version-1', documentId: 'document-1', documentTitle: 'Bedroom photographs',
    category: 'Photographs', version: 2, originalName: 'bedroom-mould.jpg', mimeType: 'image/jpeg',
    sizeBytes: 245120, sha256: '1234567890abcdef'.repeat(4), createdAt: '2026-07-13T08:30:00.000Z',
  }],
  evidenceItems: [{
    id: 'evidence-1', kind: 'photograph' as const, title: 'Bedroom mould photograph',
    description: 'Synthetic evaluation evidence.', occurredOn: '2026-07-10', provenanceSource: 'client' as const,
    provenanceDetail: 'Received by email and preserved intact.',
    documentVersion: {
      id: 'version-1', documentId: 'document-1', documentTitle: 'Bedroom photographs', category: 'Photographs',
      version: 2, originalName: 'bedroom-mould.jpg', mimeType: 'image/jpeg', sizeBytes: 245120,
      sha256: '1234567890abcdef'.repeat(4), createdAt: '2026-07-13T08:30:00.000Z',
    },
    defectIds: ['defect-1'], noticeIds: ['notice-1'], accessEventIds: [],
    createdBy: 'user-1', createdAt: '2026-07-13T08:30:00.000Z',
  }],
};

describe('EvidenceInvestigationPanel', () => {
  it('shows every readiness control, overlapping risk and immutable provenance', () => {
    render(<EvidenceInvestigationPanel matterId="matter-1" workspace={workspace} onRefresh={vi.fn()} onNavigateDocuments={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Evidence investigation' })).toBeVisible();
    expect(screen.getByText('Defect schedule recorded')).toBeVisible();
    expect(screen.getByText('Notice evidence recorded')).toBeVisible();
    expect(screen.getByText('Photographs recorded')).toBeVisible();
    expect(screen.getByText('Serious unresolved defect')).toBeVisible();
    expect(screen.getByText('Access did not complete')).toBeVisible();
    expect(screen.getByText('bedroom-mould.jpg')).toBeVisible();
    expect(screen.getByText('Version 2')).toBeVisible();
    expect(screen.getByText(/1234567890ab/)).toBeVisible();
    expect(screen.getByText('Received by email and preserved intact.')).toBeVisible();
    expect(screen.getByText('Damp and black mould')).toBeVisible();
  });

  it('directs the solicitor to Documents when no immutable version is available', async () => {
    const user = userEvent.setup();
    const onNavigateDocuments = vi.fn();
    render(
      <EvidenceInvestigationPanel
        matterId="matter-1"
        workspace={{ ...workspace, availableDocumentVersions: [] }}
        onRefresh={vi.fn()}
        onNavigateDocuments={onNavigateDocuments}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Go to Documents' }));
    expect(onNavigateDocuments).toHaveBeenCalledOnce();
  });
});

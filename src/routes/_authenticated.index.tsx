import { createFileRoute } from '@tanstack/react-router'
import { DashboardPage } from '#/components/dashboard'

const pageTitle = 'Dasbor'
const pageSubtitle = 'Ruang Kerja Digital Hanura'

export const Route = createFileRoute('/_authenticated/')({
  staticData: {
    appHeader: { title: pageTitle, subtitle: pageSubtitle },
  },
  head: () => ({
    meta: [{ title: `${pageTitle} · Hanura Digital Workspace` }],
  }),
  component: WorkspaceEntry,
})

function WorkspaceEntry() {
  return <DashboardPage />
}

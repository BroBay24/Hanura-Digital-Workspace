import { createFileRoute } from '@tanstack/react-router'
import { MemberDirectoryPage } from '#/components/members'
import { PERMISSION_CODES } from '#/lib/authorization-codes'
import { memberDirectorySearchSchema } from '#/lib/member-client'
import { hasPermission, useAuthSession } from '#/lib/session-client'

const pageTitle = 'Anggota'
const pageSubtitle = 'Ruang Kerja Digital Hanura'
const pageSize = 20

export const Route = createFileRoute('/_authenticated/members')({
  validateSearch: (search) => memberDirectorySearchSchema.parse(search),
  staticData: {
    appHeader: { title: pageTitle, subtitle: pageSubtitle },
  },
  head: () => ({
    meta: [{ title: `${pageTitle} · Hanura Digital Workspace` }],
  }),
  component: MemberDirectoryRoute,
})

function MemberDirectoryRoute() {
  const session = useAuthSession()
  const search = Route.useSearch()
  return (
    <MemberDirectoryPage
      canReadMembers={hasPermission(session.data, PERMISSION_CODES.MEMBER_READ)}
      search={{ ...search, pageSize }}
    />
  )
}

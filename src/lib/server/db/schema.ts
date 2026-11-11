import {
	pgTable,
	pgEnum,
	text,
	boolean,
	integer,
	bigint,
	doublePrecision,
	timestamp,
	jsonb,
	customType,
	primaryKey,
	uniqueIndex,
	index
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

const id = () =>
	text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID());
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();

export const actorKind = pgEnum('actor_kind', ['human', 'claude']);
export const memberRole = pgEnum('member_role', ['owner', 'editor', 'viewer']);
export const projectStatus = pgEnum('project_status', ['active', 'paused', 'done', 'archived']);
export const documentKind = pgEnum('document_kind', ['main_plan', 'note', 'research', 'decision_log']);
export const revisionKind = pgEnum('revision_kind', [
	'create',
	'edit',
	'replace',
	'restore',
	'proposal',
	'trash',
	'untrash'
]);
export const proposalStatus = pgEnum('proposal_status', ['open', 'accepted', 'rejected', 'conflicted']);
export const questionStatus = pgEnum('question_status', ['open', 'disputed', 'decided']);
export const ideaStatus = pgEnum('idea_status', ['new', 'investigating', 'adopted', 'rejected']);
export const visitChannel = pgEnum('visit_channel', ['web', 'mcp']);

/** Better Auth-kompatibilis felhasználótábla (a 3. lépésben a Better Auth ezt használja). */
export const user = pgTable('user', {
	id: id(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: boolean('email_verified').notNull().default(false),
	image: text('image'),
	createdAt: createdAt(),
	updatedAt: ts('updated_at').notNull().defaultNow()
});

export const workspace = pgTable('workspace', {
	id: id(),
	name: text('name').notNull(),
	slug: text('slug').notNull().unique(),
	createdAt: createdAt(),
	deletedAt: ts('deleted_at')
});

export const workspaceMember = pgTable(
	'workspace_member',
	{
		workspaceId: text('workspace_id')
			.notNull()
			.references(() => workspace.id),
		userId: text('user_id')
			.notNull()
			.references(() => user.id),
		role: memberRole('role').notNull(),
		createdAt: createdAt()
	},
	(t) => [primaryKey({ columns: [t.workspaceId, t.userId] })]
);

export const invitation = pgTable('invitation', {
	id: id(),
	workspaceId: text('workspace_id')
		.notNull()
		.references(() => workspace.id),
	email: text('email').notNull(),
	role: memberRole('role').notNull(),
	invitedBy: text('invited_by')
		.notNull()
		.references(() => user.id),
	createdAt: createdAt(),
	expiresAt: ts('expires_at').notNull(),
	acceptedAt: ts('accepted_at'),
	revokedAt: ts('revoked_at')
});

export const project = pgTable('project', {
	id: id(),
	workspaceId: text('workspace_id')
		.notNull()
		.references(() => workspace.id),
	name: text('name').notNull(),
	goal: text('goal').notNull().default(''),
	status: projectStatus('status').notNull().default('active'),
	/** A Claude-nak szóló szabályok, a get_project_brief elején adjuk vissza. */
	instructions: text('instructions').notNull().default(''),
	createdBy: text('created_by')
		.notNull()
		.references(() => user.id),
	createdAt: createdAt(),
	updatedAt: ts('updated_at').notNull().defaultNow(),
	deletedAt: ts('deleted_at')
});

export const document = pgTable(
	'document',
	{
		id: id(),
		projectId: text('project_id')
			.notNull()
			.references(() => project.id),
		title: text('title').notNull(),
		kind: documentKind('kind').notNull().default('note'),
		/** Védett dokumentumba a Claude csak javaslatot tehet. */
		isProtected: boolean('is_protected').notNull().default(false),
		position: doublePrecision('position').notNull().default(0),
		createdBy: text('created_by')
			.notNull()
			.references(() => user.id),
		createdAt: createdAt(),
		updatedAt: ts('updated_at').notNull().defaultNow(),
		deletedAt: ts('deleted_at')
	},
	(t) => [index('document_project_idx').on(t.projectId)]
);

export const section = pgTable(
	'section',
	{
		id: id(),
		documentId: text('document_id')
			.notNull()
			.references(() => document.id),
		title: text('title').notNull(),
		content: text('content').notNull().default(''),
		position: doublePrecision('position').notNull(),
		/** Az aktuális revíziószám; minden írás eggyel növeli. */
		revision: integer('revision').notNull().default(1),
		createdAt: createdAt(),
		updatedAt: ts('updated_at').notNull().defaultNow(),
		deletedAt: ts('deleted_at'),
		/** Teljes szöveges keresés: a cím nagyobb súllyal, magyar szótövezéssel. */
		search: tsvector('search').generatedAlwaysAs(
			(): ReturnType<typeof sql> =>
				sql`setweight(to_tsvector('hungarian', coalesce(title, '')), 'A') || setweight(to_tsvector('hungarian', coalesce(content, '')), 'B')`
		)
	},
	(t) => [
		index('section_document_idx').on(t.documentId, t.position),
		index('section_search_idx').using('gin', t.search)
	]
);

export const sectionRevision = pgTable(
	'section_revision',
	{
		id: id(),
		sectionId: text('section_id')
			.notNull()
			.references(() => section.id),
		revision: integer('revision').notNull(),
		kind: revisionKind('kind').notNull(),
		title: text('title').notNull(),
		content: text('content').notNull(),
		authorId: text('author_id')
			.notNull()
			.references(() => user.id),
		actorKind: actorKind('actor_kind').notNull(),
		reason: text('reason').notNull().default(''),
		proposalId: text('proposal_id'),
		createdAt: createdAt()
	},
	(t) => [uniqueIndex('section_revision_uq').on(t.sectionId, t.revision)]
);

/** Szakaszonként legfeljebb egy zár; a lejárt sor nem számít élőnek. */
export const sectionLock = pgTable('section_lock', {
	sectionId: text('section_id')
		.primaryKey()
		.references(() => section.id),
	holderId: text('holder_id')
		.notNull()
		.references(() => user.id),
	actorKind: actorKind('actor_kind').notNull(),
	purpose: text('purpose').notNull().default(''),
	acquiredAt: ts('acquired_at').notNull(),
	expiresAt: ts('expires_at').notNull()
});

export const proposal = pgTable(
	'proposal',
	{
		id: id(),
		documentId: text('document_id')
			.notNull()
			.references(() => document.id),
		/** Null, ha új szakaszt javasol. */
		sectionId: text('section_id').references(() => section.id),
		/** Új szakasz javaslatánál: melyik szakasz után kerüljön (null = a végére). */
		afterSectionId: text('after_section_id').references(() => section.id),
		baseRevision: integer('base_revision'),
		proposedTitle: text('proposed_title').notNull(),
		proposedContent: text('proposed_content').notNull(),
		reason: text('reason').notNull(),
		status: proposalStatus('status').notNull().default('open'),
		authorId: text('author_id')
			.notNull()
			.references(() => user.id),
		actorKind: actorKind('actor_kind').notNull(),
		createdAt: createdAt(),
		resolvedBy: text('resolved_by').references(() => user.id),
		resolvedAt: ts('resolved_at'),
		resolutionNote: text('resolution_note'),
		appliedRevision: integer('applied_revision')
	},
	(t) => [index('proposal_section_idx').on(t.sectionId, t.status)]
);

export const question = pgTable(
	'question',
	{
		id: id(),
		projectId: text('project_id')
			.notNull()
			.references(() => project.id),
		title: text('title').notNull(),
		body: text('body').notNull().default(''),
		status: questionStatus('status').notNull().default('open'),
		raisedBy: text('raised_by')
			.notNull()
			.references(() => user.id),
		actorKind: actorKind('actor_kind').notNull(),
		decision: text('decision'),
		decidedBy: text('decided_by').references(() => user.id),
		decidedAt: ts('decided_at'),
		relatedSectionIds: text('related_section_ids').array().notNull().default([]),
		createdAt: createdAt(),
		updatedAt: ts('updated_at').notNull().defaultNow()
	},
	(t) => [index('question_project_idx').on(t.projectId, t.status)]
);

export const comment = pgTable(
	'comment',
	{
		id: id(),
		projectId: text('project_id')
			.notNull()
			.references(() => project.id),
		sectionId: text('section_id').references(() => section.id),
		questionId: text('question_id').references(() => question.id),
		proposalId: text('proposal_id').references(() => proposal.id),
		parentId: text('parent_id'),
		authorId: text('author_id')
			.notNull()
			.references(() => user.id),
		actorKind: actorKind('actor_kind').notNull(),
		body: text('body').notNull(),
		resolvedAt: ts('resolved_at'),
		resolvedBy: text('resolved_by').references(() => user.id),
		createdAt: createdAt(),
		deletedAt: ts('deleted_at')
	},
	(t) => [index('comment_project_idx').on(t.projectId)]
);

export const idea = pgTable(
	'idea',
	{
		id: id(),
		projectId: text('project_id')
			.notNull()
			.references(() => project.id),
		title: text('title').notNull(),
		body: text('body').notNull().default(''),
		tags: text('tags').array().notNull().default([]),
		status: ideaStatus('status').notNull().default('new'),
		authorId: text('author_id')
			.notNull()
			.references(() => user.id),
		actorKind: actorKind('actor_kind').notNull(),
		adoptedSectionId: text('adopted_section_id').references(() => section.id),
		createdAt: createdAt(),
		updatedAt: ts('updated_at').notNull().defaultNow()
	},
	(t) => [index('idea_project_idx').on(t.projectId, t.status)]
);

export const ideaVote = pgTable(
	'idea_vote',
	{
		ideaId: text('idea_id')
			.notNull()
			.references(() => idea.id),
		userId: text('user_id')
			.notNull()
			.references(() => user.id),
		value: integer('value').notNull().default(1),
		createdAt: createdAt()
	},
	(t) => [primaryKey({ columns: [t.ideaId, t.userId] })]
);

/** Minden változás egy sorban. Az `id` növekvő, ezért kurzorként is használható. */
export const event = pgTable(
	'event',
	{
		id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
		projectId: text('project_id')
			.notNull()
			.references(() => project.id),
		actorId: text('actor_id')
			.notNull()
			.references(() => user.id),
		actorKind: actorKind('actor_kind').notNull(),
		type: text('type').notNull(),
		targetType: text('target_type').notNull(),
		targetId: text('target_id').notNull(),
		summary: text('summary').notNull(),
		data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
		createdAt: createdAt()
	},
	(t) => [index('event_project_idx').on(t.projectId, t.id)]
);

export const projectVisit = pgTable(
	'project_visit',
	{
		userId: text('user_id')
			.notNull()
			.references(() => user.id),
		projectId: text('project_id')
			.notNull()
			.references(() => project.id),
		channel: visitChannel('channel').notNull(),
		lastEventId: bigint('last_event_id', { mode: 'number' }).notNull().default(0),
		lastVisitedAt: ts('last_visited_at').notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.userId, t.projectId, t.channel] })]
);

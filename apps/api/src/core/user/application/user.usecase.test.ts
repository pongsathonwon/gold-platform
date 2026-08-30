import { Effect, Layer, Option } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import { UserRepository, type ForUserRepository } from '../port/user.port.js'
import { makeDeactivateUserUseCase, makeRestoreUserUseCase } from './user.usecase.js'
import type { User } from '../domain/user.entity.js'
import type { UserRole } from '../../../infrastructure/db/schema/user.schema.js'

/** Fixed uuids, so the tests still read as "the caller" and "someone else". */
const CALLER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const MISSING = '99999999-9999-4999-8999-999999999999'

const user = (over: Partial<User> & { id: string }): User => ({
    name: 'Somchai',
    username: `user-${over.id.slice(0, 8)}`,
    passwordHash: 'hash',
    role: 'OPERATOR' as UserRole,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    ...over,
})

/** A repository whose reads are fixed and whose writes are spies. */
const fakeRepo = (over: Partial<ForUserRepository> = {}) => {
    const deactivateById = vi.fn((id: string) =>
        Effect.succeed(user({ id, deletedAt: new Date() })),
    )
    const restoreById = vi.fn((id: string) => Effect.succeed(user({ id, deletedAt: null })))
    const repo = {
        findAll: () => Effect.succeed([]),
        findById: (id: string) => Effect.succeed(Option.some(user({ id }))),
        findByUsername: () => Effect.succeed(Option.none()),
        createUser: () => Effect.die('not used'),
        deactivateById,
        restoreById,
        countActiveAdmins: () => Effect.succeed(2),
        ...over,
    } as ForUserRepository
    return { repo, deactivateById, restoreById }
}

const run = <A, E>(effect: Effect.Effect<A, E, UserRepository>, repo: ForUserRepository) =>
    Effect.runPromiseExit(effect.pipe(Effect.provide(Layer.succeed(UserRepository, repo))))

const failureTag = (exit: Awaited<ReturnType<typeof run>>) =>
    exit._tag === 'Failure' ? JSON.stringify(exit.cause).match(/"_tag":"(\w+Error)"/)?.[1] : undefined

describe('deactivating a user', () => {
    it('sets the tombstone on someone else', async () => {
        const { repo, deactivateById } = fakeRepo()
        const exit = await run(makeDeactivateUserUseCase(OTHER, CALLER), repo)
        expect(exit._tag).toBe('Success')
        expect(deactivateById).toHaveBeenCalledWith(OTHER)
    })

    it('refuses to deactivate the caller', async () => {
        // The issued token stays valid for the rest of its hour, so this would not even fail
        // usefully — the caller keeps working and is locked out later with no cause on screen.
        const { repo, deactivateById } = fakeRepo()
        const exit = await run(makeDeactivateUserUseCase(CALLER, CALLER), repo)
        expect(failureTag(exit)).toBe('CannotDeactivateSelfError')
        expect(deactivateById).not.toHaveBeenCalled()
    })

    it('refuses the last active admin', async () => {
        // Creating accounts, restoring them and adjusting stock are all ADMIN-only, so an
        // installation with no active admin cannot appoint one. Recovery is a manual UPDATE.
        const { repo, deactivateById } = fakeRepo({
            findById: (id: string) => Effect.succeed(Option.some(user({ id, role: 'ADMIN' }))),
            countActiveAdmins: () => Effect.succeed(1),
        })
        const exit = await run(makeDeactivateUserUseCase(OTHER, CALLER), repo)
        expect(failureTag(exit)).toBe('LastAdminError')
        expect(deactivateById).not.toHaveBeenCalled()
    })

    it('allows an admin out while another remains', async () => {
        const { repo, deactivateById } = fakeRepo({
            findById: (id: string) => Effect.succeed(Option.some(user({ id, role: 'ADMIN' }))),
            countActiveAdmins: () => Effect.succeed(2),
        })
        const exit = await run(makeDeactivateUserUseCase(OTHER, CALLER), repo)
        expect(exit._tag).toBe('Success')
        expect(deactivateById).toHaveBeenCalledWith(OTHER)
    })

    it('does not count admins when the target is an operator', async () => {
        // The guard is about administrators; an operator can always go, and the count is a query
        // worth not making.
        const countActiveAdmins = vi.fn(() => Effect.succeed(1))
        const { repo } = fakeRepo({ countActiveAdmins })
        const exit = await run(makeDeactivateUserUseCase(OTHER, CALLER), repo)
        expect(exit._tag).toBe('Success')
        expect(countActiveAdmins).not.toHaveBeenCalled()
    })

    it('does not count admins when the target admin is already deactivated', async () => {
        // An already-off admin is not holding the installation open, so switching it off again
        // cannot be the move that locks everyone out.
        const countActiveAdmins = vi.fn(() => Effect.succeed(1))
        const { repo } = fakeRepo({
            findById: (id: string) =>
                Effect.succeed(Option.some(user({ id, role: 'ADMIN', deletedAt: new Date() }))),
            countActiveAdmins,
        })
        const exit = await run(makeDeactivateUserUseCase(OTHER, CALLER), repo)
        expect(exit._tag).toBe('Success')
        expect(countActiveAdmins).not.toHaveBeenCalled()
    })

    it('reports a missing user rather than deactivating nothing', async () => {
        const { repo } = fakeRepo({ findById: () => Effect.succeed(Option.none()) })
        const exit = await run(makeDeactivateUserUseCase(MISSING, CALLER), repo)
        expect(failureTag(exit)).toBe('UserNotFoundError')
    })
})

describe('restoring a user', () => {
    it('clears the tombstone with no guard', async () => {
        // Restoring only ever adds access, so there is nothing to protect against here.
        const { repo, restoreById } = fakeRepo()
        const exit = await run(makeRestoreUserUseCase(OTHER), repo)
        expect(exit._tag).toBe('Success')
        expect(restoreById).toHaveBeenCalledWith(OTHER)
    })
})

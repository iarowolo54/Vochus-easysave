// One pop-up at a time. The sign-in pop-ups (super admin's messages, the photo reminder) each ask for a turn and give
// it back when closed, so two never open on top of each other. First to ask goes first.

/** A queue of turns. `take()` resolves with a release function once every earlier turn has been released. */
export function createPopupQueue(): () => Promise<() => void> {
  let tail: Promise<void> = Promise.resolve()
  return function take() {
    let done!: () => void
    const finished = new Promise<void>(resolve => { done = resolve })
    const turn = tail.then(() => done)
    tail = tail.then(() => finished)
    return turn
  }
}

/** The app-wide queue the pop-ups share. */
export const takePopupSlot = createPopupQueue()

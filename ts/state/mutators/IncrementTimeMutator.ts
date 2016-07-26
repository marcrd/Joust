import GameState from "../GameState";
import GameStateMutator from "../GameStateMutator";

class IncrementTimeMutator implements GameStateMutator {
	constructor(public time: number = 1) {
	}

	public applyTo(state: GameState): GameState {
		if (this.time === 0 && state.time !== null) {
			return state;
		}

		var time = state.time;
		if (time === null) {
			time = 0;
		}
		else {
			time += this.time;
		}

		if(time === state.time) {
			return state;
		}

		return new GameState(state.entities, state.entityTree, state.options, state.optionTree, time, state.choices, state.descriptors, state.diffs.clear());
	}
}

export default IncrementTimeMutator;

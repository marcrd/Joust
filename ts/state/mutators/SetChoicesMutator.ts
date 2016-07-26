import * as Immutable from "immutable";
import GameState from "../GameState";
import GameStateMutator from "../GameStateMutator";
import Choice from "../../Choice";
import Choices from "../../Choices";

class SetChoicesMutator implements GameStateMutator {
	constructor(public player: number, public choices: Choices) {
	}

	public applyTo(state: GameState): GameState {
		let choices = state.choices;
		choices = choices.set(+this.player, this.choices);
		return new GameState(state.entities, state.entityTree, state.options, state.optionTree, state.time, choices, state.descriptors, state.diffs);
	}
}

export default SetChoicesMutator;

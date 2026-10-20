// AGPL-3.0. Reward-screen option for a server-made Collector Crypt card offer.
import type { CardOffer } from "#app/catch/catch-client";
import { ModifierTier } from "#enums/modifier-tier";
import { ModifierType } from "#modifiers/modifier-type";

export class CardOfferModifierType extends ModifierType {
  constructor(public readonly offer: CardOffer) {
    super(null, "cc_card", null, "cc_card", "se/pb_rel");
    this.id = "CC_CARD_OFFER";
    this.tier = ModifierTier.MASTER;
  }
  override get name(): string {
    return "Random Collector Crypt Card";
  }
  override getDescription(): string {
    return "A Collector Crypt card is reserved for you. Pick it to claim it at catchcrypt.com instead of an item.";
  }
}

import {
  GetStartedOfferContext,
  useCollectGetStartedOffer,
} from "../content/getStartedOffer";
import CoilboxHome from "./CoilboxHome";

/**
 * Coilbox's `/` route: the get-started offer, collected once, and then the page.
 *
 * The offer has two readers on this page, `GetStartedCard` which draws it and
 * the page itself which needs to know whether onboarding is offering maps before
 * it can place the suggested map card. Each used to collect its own, which is
 * two directory listings and two per-visit snapshots of one question (issue
 * #1111). One collection, read from a context, is the shape issue #1077 settled
 * on for the suggested map.
 *
 * Above {@link CoilboxHome} rather than inside it, because both of its arms draw
 * that card: a distribution with a `welcome` gets the onboarding zone beside the
 * welcome, and everything else gets it in the layout. A collection inside the
 * layout arm would leave the branded arm with no offer to read.
 *
 * The visit is the offer's lifetime, and this component is where the visit
 * begins and ends. The snapshot exists so the list cannot shrink under a reader
 * who is looking at it (issue #526), and it is released when the page is left so
 * that coming back asks again (PR #1121).
 *
 * The widget form of the onboarding cards is not on this route and collects for
 * itself. See `HomeSetupCard`.
 */
export default function HomeRoute() {
  const offer = useCollectGetStartedOffer();
  return (
    <GetStartedOfferContext value={offer}>
      <CoilboxHome />
    </GetStartedOfferContext>
  );
}

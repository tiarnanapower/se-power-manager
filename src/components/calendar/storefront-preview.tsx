"use client";

import { useState } from "react";
import { useCopilot } from "@/components/shell/copilot-context";
import type { CalendarPromotion } from "@/lib/promo-calendar/types";

type Scene = "HOME_PAGE" | "PRODUCT_PAGE" | "CART_PAGE";

const SCENES: Array<[Scene, string]> = [["HOME_PAGE", "Home page"], ["PRODUCT_PAGE", "Product page"], ["CART_PAGE", "Cart"]];
const SAMPLE_PRICE = 100;

// Message text only: never render store-supplied markup.
const plain = (value: string) => value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

function money(symbol: string, value: number): string {
  return `${symbol}${value.toFixed(2)}`;
}

// What the shopper pays for the sample item, for simple percent / amount rewards.
function discountOn(promotion: CalendarPromotion): number | null {
  if (promotion.rewardValue === null) return null;
  if (promotion.rewardKind === "percent") return Math.min(SAMPLE_PRICE, (SAMPLE_PRICE * promotion.rewardValue) / 100);
  if (promotion.rewardKind === "amount") return Math.min(SAMPLE_PRICE, promotion.rewardValue);

  return null;
}

function Placeholder({ w, h = 10 }: { w: string; h?: number }) {
  return <span className="pp-sf__ph" style={{ width: w, height: h }} />;
}

// An illustrative storefront: the promotion's own banner and cart messages in
// the places it is set to show. Themes control exact styling.
export function StorefrontPreview({ promotion, currencySymbol }: { promotion: CalendarPromotion; currencySymbol: string }) {
  const copilot = useCopilot();
  const [scene, setScene] = useState<Scene>("HOME_PAGE");
  const message = (type: "UPSELL" | "ELIGIBLE" | "APPLIED") => {
    const found = promotion.notifications.find((n) => n.type === type && (n.locations.length === 0 || n.locations.includes(scene)));

    return found ? plain(found.content) : undefined;
  };
  const banner = message("UPSELL");
  const eligible = message("ELIGIBLE");
  const applied = message("APPLIED");
  const off = discountOn(promotion);
  const freeShipping = promotion.rewardKind === "shipping";
  const live = promotion.state === "live";
  const askForCopy = () => copilot.ask(`Write storefront banner copy for "${promotion.displayName}" (${promotion.discountSummary}) and propose it as a change to this promotion. Show the draft for my review.`);

  return (
    <div>
      {!live && <p className="pp-sf__note">Shoppers can&apos;t see this yet ({promotion.state}). This is how it will look once it&apos;s live.</p>}

      <div className="pp-seg" role="group" aria-label="Storefront page" style={{ marginBottom: 12 }}>
        {SCENES.map(([key, label]) => (
          <button key={key} type="button" className="pp-seg__btn" aria-pressed={scene === key} onClick={() => setScene(key)}>{label}</button>
        ))}
      </div>

      <div className="pp-sf" aria-label="Storefront preview">
        <div className="pp-sf__bar" aria-hidden><span /><span /><span /></div>
        {banner ? (
          <div className="pp-sf__banner">{banner}</div>
        ) : scene !== "CART_PAGE" ? (
          <div className="pp-sf__banner pp-sf__banner--empty">No banner message for this page</div>
        ) : null}

        {scene === "HOME_PAGE" && (
          <div className="pp-sf__body">
            <div className="pp-sf__hero"><Placeholder w="46%" h={14} /><Placeholder w="30%" /></div>
            <div className="pp-sf__grid">
              {[0, 1, 2].map((i) => (
                <div key={i} className="pp-sf__tile"><span className="pp-sf__img" /><Placeholder w="80%" /><Placeholder w="40%" /></div>
              ))}
            </div>
          </div>
        )}

        {scene === "PRODUCT_PAGE" && (
          <div className="pp-sf__body pp-sf__product">
            <span className="pp-sf__img pp-sf__img--lg" />
            <div className="pp-sf__info">
              <strong>Sample product</strong>
              <div className="pp-sf__price">
                {off !== null ? (
                  <>
                    <s>{money(currencySymbol, SAMPLE_PRICE)}</s> <b>{money(currencySymbol, SAMPLE_PRICE - off)}</b>
                  </>
                ) : (
                  <b>{money(currencySymbol, SAMPLE_PRICE)}</b>
                )}
              </div>
              {freeShipping && <div className="pp-sf__tagline">Free shipping on this order</div>}
              <span className="pp-sf__btn">Add to cart</span>
            </div>
          </div>
        )}

        {scene === "CART_PAGE" && (
          <div className="pp-sf__body">
            {eligible && <div className="pp-sf__msg">{eligible}</div>}
            <div className="pp-sf__line"><span>Sample product × 1</span><span>{money(currencySymbol, SAMPLE_PRICE)}</span></div>
            {off !== null && (
              <div className="pp-sf__line pp-sf__line--disc"><span>{promotion.displayName}</span><span>-{money(currencySymbol, off)}</span></div>
            )}
            {freeShipping && <div className="pp-sf__line pp-sf__line--disc"><span>Shipping</span><span>Free</span></div>}
            {off === null && !freeShipping && <div className="pp-sf__line pp-sf__line--disc"><span>{promotion.displayName}</span><span>Applied</span></div>}
            {applied && <div className="pp-sf__msg pp-sf__msg--ok">{applied}</div>}
            <div className="pp-sf__line pp-sf__line--total"><span>Total</span><span>{money(currencySymbol, SAMPLE_PRICE - (off ?? 0))}</span></div>
          </div>
        )}
      </div>

      <p className="pp-muted" style={{ fontSize: 12, margin: "10px 2px 12px" }}>Illustration. Your theme controls the exact look and placement.</p>
      {promotion.notifications.length === 0 && (
        <button type="button" className="pp-btn" onClick={askForCopy}>Write banner copy with Copilot</button>
      )}
    </div>
  );
}

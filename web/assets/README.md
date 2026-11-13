# Asset marks

These bundled marks identify the assets shown in the web wallet. They are decorative; the
adjacent asset names provide the accessible labels. The files load from this application,
without contacting the brand sites at runtime.

| File | Official source | Supplied artwork |
| --- | --- | --- |
| `zcash.svg` | [Zcash Media Kit](https://z.cash/press/) | [Yellow brandmark SVG](https://z.cash/wp-content/uploads/2023/11/Brandmark-Yellow.svg) |
| `solana.svg` | [Solana Brand Assets and Guidelines](https://solana.com/branding) | [Gradient logomark SVG](https://solana.com/src/img/branding/solanaLogoMark.svg) |
| `usdc.svg` | [Circle Pressroom Brand Kit](https://www.circle.com/pressroom#brand-kit) | `Token Logo/USDC Token.svg` in the [official USDC download](https://6778953.fs1.hubspotusercontent-na1.net/hubfs/6778953/Pressroom/brandkit/logo-downloads/usdc.zip) |

Retrieved 21 October 2026. Colors, paths and proportions are unchanged. The Zcash SVG's empty
outer canvas was trimmed through its viewBox; its artwork was not redrawn. The official USDC
token artwork requires a minimum displayed height of 32px. Do not recolor, apply filters to,
distort or overlay these marks.

All trademarks are property of their respective owners. The artwork is governed by its owners'
brand terms, separately from this repository's software license:

- [Zcash Trademark Policy](https://zfnd.org/trademark-policy/).
- [Solana brand guidelines and use terms](https://solana.com/branding#use-and-permissions).
- [Circle Brand Use Policy](https://6778953.fs1.hubspotusercontent-na1.net/hubfs/6778953/CircleBrandUsePolicy.pdf).
  Its current terms restrict commercial use and preserve Circle's rights in the digital asset
  marks; inclusion here does not grant additional rights.

Use identifies the underlying assets only. It does not indicate sponsorship, endorsement or
affiliation, and does not imply that an unavailable asset is supported. Keep these marks
separate from the Zigs logo, application icon and favicon.

## Swap provider credits

- `near-sculpted.svg` uses the NEAR logomark from the header of [near.org](https://near.org/),
  retrieved 13 November 2026. Its original path is preserved; the silver face, depth and lighting
  are a custom Zigs presentation treatment. The adjacent text reads “Powered by NEAR Confidential
  Intents” across swap modes. The selected mode's disclosure continues to distinguish a public
  route, a simulation and requested confidential execution.
- `helius.svg` is the unchanged orange logomark from the [official Helius Brand Kit](https://www.helius.dev/brand):
  [Helius Icon SVG](https://www.helius.dev/Helius-Brandkit/Helius/Helius-Icon.svg).
  It identifies [Helius Privacy Rings](https://www.helius.dev/solana-privacy-rings) for private SOL
  funding. It is not shown as a privacy credit for a public SOL source or destination.

Both assets are served locally. Provider branding does not establish that a swap is private
end to end; the public deposit boundary remains visible in the tutorial and review.

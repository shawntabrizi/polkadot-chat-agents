// Chain descriptors, shipped pre-generated. Published packages must not run
// `papi generate` on the consumer's machine (its codegen toolchain breaks under
// consumer hoisting), so `prepare` generates at dev-install/pack time and this
// module re-exports the committed-to-tarball dist by relative path — no
// file:-protocol dependency involved.
export { paseoPeopleNext } from "../vendor/descriptors/index.js";

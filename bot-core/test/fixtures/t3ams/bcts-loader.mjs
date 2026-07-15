export async function resolve(specifier, context, nextResolve) {
  const override = process.env.PCA_TEST_T3AMS_BCTS_MODULE;
  if (specifier === "@t3ams/bcts" && override) {
    return { url: override, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

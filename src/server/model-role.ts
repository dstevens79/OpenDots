import type { ProviderConfig } from './store.js';

/** Select the background model only for scheduler-originated turns. */
export function providerForTurn(
  provider: ProviderConfig,
  scheduled: boolean,
): ProviderConfig {
  const residentConnection = provider.connections?.find(
    (connection) => connection.id === provider.residentConnectionId,
  );
  const housekeepingConnection = provider.connections?.find(
    (connection) => connection.id === provider.housekeepingConnectionId,
  );

  if (scheduled && housekeepingConnection) {
    return {
      ...provider,
      kind: housekeepingConnection.kind,
      baseUrl: housekeepingConnection.baseUrl,
      model:
        provider.housekeepingModel ||
        (housekeepingConnection.id === provider.residentConnectionId
          ? provider.model
          : housekeepingConnection.model),
      apiKey: housekeepingConnection.apiKey,
    };
  }
  if (residentConnection) {
    return {
      ...provider,
      kind: residentConnection.kind,
      baseUrl: residentConnection.baseUrl,
      model: provider.model || residentConnection.model,
      apiKey: residentConnection.apiKey,
    };
  }
  if (
    !scheduled ||
    !provider.housekeepingBaseUrl ||
    !provider.housekeepingModel
  )
    return provider;
  return {
    ...provider,
    kind: provider.housekeepingKind ?? provider.kind,
    baseUrl: provider.housekeepingBaseUrl,
    model: provider.housekeepingModel,
    apiKey: provider.housekeepingApiKey ?? provider.apiKey,
  };
}

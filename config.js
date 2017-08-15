module.exports = {
  config: {
    keyspace: 'bffs',
    user: 'cassandra',
    password: 'cassandra',
    hosts: ['127.0.0.1'],
    keyspaceOptions: {
      class: 'SimpleStrategy',
      replication_factor: 1
    }
  }
};

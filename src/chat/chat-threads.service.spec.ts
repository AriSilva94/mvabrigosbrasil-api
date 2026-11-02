import { toInboxThread } from './chat-threads.service';

const row = {
  id: 't1',
  status: 'active',
  updatedAt: new Date('2026-11-02T10:00:00.000Z'),
  volunteerProfileId: 'vol',
  shelterProfileId: 'she',
  vacancy: { title: 'Cuidador', slug: 'cuidador' },
  shelter: { name: 'Abrigo Feliz' },
  volunteer: { name: 'Maria' },
};

describe('toInboxThread', () => {
  it('names the shelter for the volunteer and the volunteer for the shelter', () => {
    expect(toInboxThread(row, 'vol', null, 0).other_participant_name).toBe(
      'Abrigo Feliz',
    );
    expect(toInboxThread(row, 'she', null, 0).other_participant_name).toBe(
      'Maria',
    );
  });

  it('falls back to "Vaga"/"Abrigo"/"Voluntário"', () => {
    const empty = {
      ...row,
      vacancy: { title: '', slug: null },
      shelter: { name: '' },
      volunteer: { name: '' },
    };
    expect(toInboxThread(empty, 'vol', null, 0)).toMatchObject({
      vacancy_title: 'Vaga',
      vacancy_slug: null,
      other_participant_name: 'Abrigo',
    });
    expect(toInboxThread(empty, 'she', null, 0).other_participant_name).toBe(
      'Voluntário',
    );
  });

  it('serializes dates and the last message in snake_case', () => {
    const last = {
      content: 'oi',
      sender_id: 'she',
      created_at: '2026-11-02T10:00:00.000Z',
      message_type: 'text',
    };
    expect(toInboxThread(row, 'vol', last, 3)).toEqual({
      id: 't1',
      status: 'active',
      updated_at: '2026-11-02T10:00:00.000Z',
      volunteer_profile_id: 'vol',
      shelter_profile_id: 'she',
      vacancy_title: 'Cuidador',
      vacancy_slug: 'cuidador',
      other_participant_name: 'Abrigo Feliz',
      last_message: last,
      unread_count: 3,
    });
  });
});

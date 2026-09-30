-- Up Migration

-- Os tempos que a loja estima, em minutos: preparo (retirada) e a faixa de
-- entrega. Nulos = sem previsão — o acompanhamento não inventa hora.
alter table restaurants add column prep_time_minutes integer;
alter table restaurants add column delivery_time_min_minutes integer;
alter table restaurants add column delivery_time_max_minutes integer;
alter table restaurants
  add constraint restaurants_times_check check (
    (prep_time_minutes is null or prep_time_minutes between 1 and 240)
    and (
      (delivery_time_min_minutes is null and delivery_time_max_minutes is null)
      or (
        delivery_time_min_minutes between 1 and 240
        and delivery_time_max_minutes between 1 and 240
        and delivery_time_min_minutes <= delivery_time_max_minutes
      )
    )
  );

-- Down Migration

alter table restaurants drop constraint restaurants_times_check;
alter table restaurants drop column delivery_time_max_minutes;
alter table restaurants drop column delivery_time_min_minutes;
alter table restaurants drop column prep_time_minutes;
